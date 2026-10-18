import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db.js';
import { ticketScope, canSeeOrg, requirePermission } from '../middleware/index.js';
import {
  logActivity, notifyAssignment, assertAssignable, assertProjectInOrg, assertInternalTeam, syncTaskFromTicket, notifyPeople, findTriagers,
} from '../services/index.js';
import { canViewTicket, ticketEditScope, TICKET_FIELDS, clientStatusChangeAllowed } from '../rbac/policies.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { ticketCreate, ticketUpdate, commentCreate } from '../validators/schemas.js';

const router = Router();
const authorSelect = { author: { select: { id: true, name: true, email: true } } };
const ticketUrl = (t) => `/?ticket=${t.id}`;
const nice = (v) => String(v).replaceAll('_', ' ').toLowerCase();

/** Keep the right people in the loop. Clients only ever hear about CLIENT-visible events. */
async function notifyTicket(req, t, { title, body, toRequester = false }) {
  const requesterIsClient = t.requesterId && t.requesterId !== t.assigneeId && t.visibility === 'CLIENT';
  const staff = t.assigneeId ? [t.assigneeId] : (await findTriagers()).map((u) => u.id);
  const ids = toRequester ? (requesterIsClient ? [t.requesterId] : []) : staff;
  await notifyPeople({ userIds: ids, actorId: req.currentUser.id, type: 'STATUS_CHANGE', title, body, href: ticketUrl(t) });
}

async function loadVisibleTicket(req) {
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!t || !canViewTicket(req, t)) throw new AppError('Ticket not found', 404); // hide existence
  return t;
}
const ticketLog = (req, t, action, summary) =>
  logActivity({
    actorId: req.currentUser.id, organizationId: t.organizationId, entityType: 'ticket', entityId: t.id, action, summary,
    metadata: { visibility: t.visibility, requesterId: t.requesterId },
  });

router.get('/tickets', async (req, res) => {
  const q = req.query.q ? String(req.query.q) : '';
  const search = q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { key: { contains: q, mode: 'insensitive' } }] } : {};
  res.json(
    await prisma.ticket.findMany({
      where: { AND: [ticketScope(req), search] }, orderBy: { updatedAt: 'desc' }, take: 150,
      include: {
        organization: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true } },
        requester: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true, tasks: true, attachments: true } },
        // the linked work item is internal: clients never see it
        ...(req.isInternal ? { tasks: { where: { autoCreated: true }, take: 1, select: { id: true, status: true, assigneeId: true } } } : {}),
      },
    })
  );
});

async function createWithUniqueKey(data, slug) {
  for (let i = 0; i < 5; i++) {
    const key = `${slug.slice(0, 3).toUpperCase()}-${crypto.randomInt(100000, 999999)}`;
    try {
      return await prisma.ticket.create({ data: { ...data, key } });
    } catch (e) {
      if (e.code !== 'P2002') throw e;
    }
  }
  throw new AppError('Could not allocate a ticket key, please retry', 503);
}

router.post('/tickets', requirePermission('ticket.create'), async (req, res) => {
  const data = parseBody(ticketCreate, req.body);
  if (!canSeeOrg(req, data.organizationId)) throw new AppError('Organization access denied', 403);
  if (!req.isInternal && data.visibility === 'INTERNAL') throw new AppError('Only staff can create internal-only tickets', 403);
  if (!req.can('ticket.triage') && ((data.assigneeId && data.assigneeId !== req.currentUser.id) || data.teamId)) {
    throw new AppError("You don't have permission to assign tickets to others or to a team (ticket.triage).", 403);
  }
  await assertProjectInOrg(data.projectId, data.organizationId);
  await assertAssignable(data.assigneeId);
  await assertInternalTeam(data.teamId);

  const org = await prisma.organization.findUnique({ where: { id: data.organizationId } });
  const t = await createWithUniqueKey({ ...data, requesterId: req.currentUser.id }, org.slug);
  await ticketLog(req, t, 'created', `Created ticket ${t.key}: ${t.title}`);
  // A client request is a TICKET (never a task). Triagers are told so it gets an owner; the assignee gets a task later.
  if (!req.isInternal) {
    await notifyPeople({ userIds: (await findTriagers()).map((u) => u.id), actorId: req.currentUser.id, type: 'ASSIGNMENT', title: `New client ticket ${t.key} (${org.name})`, body: `${req.currentUser.name || req.currentUser.email} raised: ${t.title}`, href: ticketUrl(t) });
  }

  // Assigned ticket => work item for the assignee, automatically.
  let task = null;
  if (t.assigneeId) {
    try {
      task = await prisma.$transaction((tx) => syncTaskFromTicket(tx, t, { changed: ['ALL'], actor: req.currentUser }));
    } catch (e) {
      console.error(`[ticket→task] could not create task for ${t.key}:`, e.message); // `npm run backfill:tasks` repairs this
    }
    await notifyAssignment({ userId: t.assigneeId, actor: req.currentUser, title: `${t.key} — ${t.title}`, kind: 'ticket', href: ticketUrl(t) });
  }
  res.status(201).json({ ...t, task: task && { id: task.id, status: task.status } });
});

router.patch('/tickets/:id', async (req, res) => {
  const old = await loadVisibleTicket(req);
  const data = parseBody(ticketUpdate, req.body);
  const scope = ticketEditScope(req, old);
  const forbidden = Object.keys(data).filter((k) => !TICKET_FIELDS[scope].includes(k));
  if (scope === 'none' || forbidden.length) {
    throw new AppError(scope === 'none' ? "You can't edit this ticket." : `Your role can't change: ${forbidden.join(', ')}.`, 403);
  }
  if (scope === 'client' && data.status !== undefined && !clientStatusChangeAllowed(old.status, data.status)) {
    throw new AppError('You can only approve or send back a ticket that is waiting for your review.', 403, 'CLIENT_STATUS_LOCKED');
  }
  await assertProjectInOrg(data.projectId, old.organizationId);
  await assertAssignable(data.assigneeId);
  await assertInternalTeam(data.teamId);

  const t = await prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.update({ where: { id: old.id }, data });
    await syncTaskFromTicket(tx, updated, { prevAssigneeId: old.assigneeId, changed: Object.keys(data), actor: req.currentUser });
    return updated;
  });
  if (t.assigneeId && t.assigneeId !== old.assigneeId) {
    await notifyAssignment({ userId: t.assigneeId, actor: req.currentUser, title: `${t.key} — ${t.title}`, kind: 'ticket', href: ticketUrl(t) });
  }
  await ticketLog(req, t, 'updated', `Updated ticket ${t.key}`);
  if (data.status && data.status !== old.status) {
    if (req.isInternal) {
      await notifyTicket(req, t, {
        toRequester: true,
        title: data.status === 'CLIENT_REVIEW' ? `${t.key} is ready for your review` : `${t.key} is now ${nice(data.status)}`,
        body: data.status === 'CLIENT_REVIEW' ? `Please review "${t.title}" and approve it or send it back.` : `Your request "${t.title}" moved to ${nice(data.status)}.`,
      });
    } else {
      await notifyTicket(req, t, { title: `${t.key}: client ${data.status === 'CLOSED' ? 'approved' : 'sent back'} the work`, body: `${req.currentUser.name || req.currentUser.email} ${data.status === 'CLOSED' ? 'approved' : 'asked for changes on'} "${t.title}".` });
    }
  }
  res.json(t);
});

router.get('/tickets/:id/comments', async (req, res) => {
  const t = await loadVisibleTicket(req);
  res.json(
    await prisma.comment.findMany({
      where: { ticketId: t.id, ...(req.can('ticket.view_internal') ? {} : { visibility: 'CLIENT' }) },
      orderBy: { createdAt: 'asc' }, include: authorSelect,
    })
  );
});

router.post('/tickets/:id/comments', async (req, res) => {
  const t = await loadVisibleTicket(req);
  const data = parseBody(commentCreate, req.body);
  if (data.visibility === 'INTERNAL' && !req.can('ticket.comment_internal')) throw new AppError('Internal comment permission required', 403);
  const c = await prisma.comment.create({ data: { ...data, ticketId: t.id, authorId: req.currentUser.id }, include: authorSelect });
  await logActivity({
    actorId: req.currentUser.id, organizationId: t.organizationId, entityType: 'ticket', entityId: t.id,
    action: 'commented', summary: `Comment added to ${t.key}`,
    metadata: { visibility: data.visibility === 'INTERNAL' ? 'INTERNAL' : t.visibility, requesterId: t.requesterId },
  });
  if (data.visibility === 'CLIENT') {
    const fromStaff = req.isInternal;
    await notifyTicket(req, t, { toRequester: fromStaff, title: `New comment on ${t.key}`, body: `${req.currentUser.name || req.currentUser.email}: ${data.body.slice(0, 200)}` });
  }
  res.status(201).json(c);
});
export default router;
