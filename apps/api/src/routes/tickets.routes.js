import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../db.js';
import { ticketScope, canSeeOrg, requirePermission } from '../middleware/index.js';
import {
  logActivity, notifyAssignment, assertAssignable, assertProjectInOrg, assertInternalTeam, syncTaskFromTicket, notifyPeople, findTriagers, findTeamManagers, loadTeamMemberIds, recordTicketEvents, loadNames, diffTicketEvents, clientView,
} from '../services/index.js';
import { employeeIds, finishBlocked, notifyReviewReady, NEEDS_MANAGER_REVIEW_MESSAGE } from '../services/ticketReview.js';
import { canDeleteTicket } from '../services/ticketReviewRules.js';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import { env } from '../config/env.js';
import { accessTeamIdsFor, isMemberOfAnyTeam, planAssignee, normalizeTeamPicks } from '../services/ticketRouting.js';
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
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id }, include: { teamAccesses: { select: { teamId: true, accessRole: true, addedById: true } } } });
  if (!t || !canViewTicket(req, t)) throw new AppError('Ticket not found', 404); // hide existence
  return t;
}
const ticketLog = (req, t, action, summary) =>
  logActivity({
    actorId: req.currentUser.id, organizationId: t.organizationId, entityType: 'ticket', entityId: t.id, action, summary,
    metadata: { visibility: t.visibility, requesterId: t.requesterId },
  });

async function assertTicketWorkComplete(ticketId) {
  const roots = await prisma.task.findMany({ where: { ticketId }, select: { id: true, title: true, status: true, autoCreated: true } });
  const seen = new Set();
  let frontier = roots;
  while (frontier.length) {
    const current = frontier.filter((task) => !seen.has(task.id));
    if (!current.length) break;
    for (const task of current) {
      seen.add(task.id);
      if (!task.autoCreated && task.status !== 'DONE') throw new AppError(`Cannot resolve or close this ticket until all linked tasks and subtasks are DONE.`, 409, 'TICKET_WORK_INCOMPLETE');
    }
    frontier = await prisma.task.findMany({ where: { parentId: { in: current.map((t) => t.id) } }, select: { id: true, title: true, status: true, autoCreated: true } });
  }
}

router.get('/tickets', async (req, res) => {
  const list = await listTickets(req);
  if (!req.isInternal) return res.json(list);
  const emp = await employeeIds(prisma, list.map((t) => t.requesterId));
  res.json(list.map((t) => ({ ...t, employeeReview: !emp.has(t.requesterId) })));
});

async function listTickets(req) {
  const q = req.query.q ? String(req.query.q) : '';
  const search = q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { key: { contains: q, mode: 'insensitive' } }] } : {};
  return (
    await prisma.ticket.findMany({
      where: { AND: [ticketScope(req), search] }, orderBy: { updatedAt: 'desc' }, take: 150,
      include: {
        organization: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true } },
        requester: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true, tasks: true, attachments: true } },
        ...(req.isInternal ? { teamAccesses: { include: { team: { select: { id: true, name: true, slug: true } } } } } : {}),
        // the linked work item is internal: clients never see it
        tasks: { where: req.isInternal ? { autoCreated: true } : {}, orderBy: { createdAt: 'asc' }, select: { id: true, title: true, description: true, status: true, createdAt: true, dueDate: true, autoCreated: true, parentId: true, subtasks: { orderBy: { createdAt: 'asc' }, select: { id: true, title: true, description: true, status: true, createdAt: true, dueDate: true, parentId: true } } } },
      },
    })
  );
}

async function createWithUniqueKey(data, slug, client = prisma) {
  for (let i = 0; i < 5; i++) {
    const key = `${slug.slice(0, 3).toUpperCase()}-${crypto.randomInt(100000, 999999)}`;
    try {
      return await client.ticket.create({ data: { ...data, key } });
    } catch (e) {
      if (e.code !== 'P2002') throw e;
    }
  }
  throw new AppError('Could not allocate a ticket key, please retry', 503);
}

router.post('/tickets', requirePermission('ticket.create'), async (req, res) => {
  const parsed = parseBody(ticketCreate, req.body);
  let { teamIds = [], ...data } = parsed;
  if (!canSeeOrg(req, data.organizationId)) throw new AppError('Organization access denied', 403);
  if (!req.isInternal && data.visibility === 'INTERNAL') throw new AppError('Only staff can create internal-only tickets', 403);
  // Clients may only ASK for teams (the ones the admin made visible to clients); employees of those teams get it.
  const clientPicks = !req.isInternal ? normalizeTeamPicks(data.teamId, teamIds) : null;
  if (clientPicks) {
    const ids = [clientPicks.teamId, ...clientPicks.teamIds].filter(Boolean);
    if (ids.length) {
      const ok = await prisma.team.count({ where: { id: { in: ids }, isActive: true, clientVisible: true, organization: { type: 'INTERNAL' } } });
      if (ok !== ids.length) throw new AppError('Pick one of the teams offered in the list.', 400, 'INVALID_TEAM');
    }
    data = { ...data, teamId: clientPicks.teamId || undefined };
    teamIds = clientPicks.teamIds;
  }
  const crossTeam = req.can('ticket.triage') || req.can('work.cross_team');
  if (!crossTeam && data.assigneeId && data.assigneeId !== req.currentUser.id) {
    throw new AppError("You don't have permission to assign tickets to others (ticket.triage).", 403);
  }
  const ownTeamIds = [...new Set(req.memberships.flatMap((m) => (m.teamMemberships || []).map((tm) => tm.teamId)))];
  if (req.isInternal && !req.can('ticket.triage')) {
    if (!crossTeam && data.teamId && !ownTeamIds.includes(data.teamId)) throw new AppError('You can only raise a ticket for one of your own teams.', 403, 'TEAM_SCOPE_DENIED');
    if (!data.teamId && ownTeamIds.length === 1) data.teamId = ownTeamIds[0];
    if (!data.teamId && ownTeamIds.length > 1) throw new AppError('Select which of your teams owns this ticket.', 400, 'TEAM_REQUIRED');
    if (!data.teamId && !ownTeamIds.length) throw new AppError('Join a team before creating an internal ticket.', 400, 'TEAM_REQUIRED');
  }
  await assertProjectInOrg(data.projectId, data.organizationId);
  await assertAssignable(data.assigneeId);
  await assertInternalTeam(data.teamId);
  if (teamIds.length && !crossTeam) throw new AppError('Only authorized triagers can share a ticket with additional teams.', 403);
  const accessTeamIds = accessTeamIdsFor(data.teamId, teamIds);
  if (req.isInternal && data.assigneeId) {
    // Team first, then assignee: the assignee must belong to the ticket's team.
    if (!accessTeamIds.length) throw new AppError('Pick a team first, then choose an assignee from that team.', 409, 'TICKET_NOT_ROUTED');
    const members = await loadTeamMemberIds(accessTeamIds);
    if (!isMemberOfAnyTeam(data.assigneeId, accessTeamIds, members)) throw new AppError('The assignee must be a member of the ticket’s team.', 400, 'ASSIGNEE_NOT_IN_TEAM');
  }
  if (accessTeamIds.length) {
    const valid = await prisma.team.findMany({ where: { id: { in: accessTeamIds }, isActive: true, organization: { type: 'INTERNAL' } }, select: { id: true } });
    if (valid.length !== accessTeamIds.length) throw new AppError('One or more participating teams are invalid.', 400, 'INVALID_TEAM');
  }
  const org = await prisma.organization.findUnique({ where: { id: data.organizationId } });
  const t = await prisma.$transaction(async (tx) => {
    const created = await createWithUniqueKey({ ...data, requesterId: req.currentUser.id }, org.slug, tx);
    const ids = [...new Set([...(data.teamId ? [data.teamId] : []), ...teamIds])];
    if (ids.length) await tx.ticketTeamAccess.createMany({ data: ids.map((teamId) => ({ ticketId: created.id, teamId, accessRole: teamId === data.teamId ? 'OWNER' : 'PARTICIPANT', addedById: req.currentUser.id })), skipDuplicates: true });
    return created;
  });
  await ticketLog(req, t, 'created', `Created ticket ${t.key}: ${t.title}`);
  {
    const base = { title: t.title, description: t.description, status: t.status, priority: t.priority, dueDate: t.dueDate, visibility: t.visibility, projectId: t.projectId, teamId: null, assigneeId: null };
    const names = await loadNames({ userIds: [t.assigneeId], teamIds: accessTeamIds });
    await recordTicketEvents(prisma, t.id, req.currentUser.id, [
      { type: 'CREATED', note: t.key, clientVisible: true },
      ...diffTicketEvents({ old: base, updated: t, oldTeamIds: [], newTeamIds: accessTeamIds, names }).filter((e) => ['TEAM', 'ASSIGNEE', 'TEAM_ACCESS'].includes(e.type)),
    ]);
  }
  // Staff who route a ticket to a team that is not theirs tell that team's employees, so it gets picked up.
  if (req.isInternal && accessTeamIds.some((id) => !ownTeamIds.includes(id))) {
    const managers = await findTeamManagers(accessTeamIds.filter((id) => !ownTeamIds.includes(id)));
    await notifyPeople({ userIds: managers.map((u) => u.id), actorId: req.currentUser.id, type: 'ASSIGNMENT', title: `${t.key} was sent to your team`, body: `${req.currentUser.name || req.currentUser.email}: ${t.title}`, href: ticketUrl(t) });
  }
  // A client request is a TICKET (never a task). Triagers are told so it gets an owner; the assignee gets a task later.
  if (!req.isInternal) {
    // Team chosen by the client => that team's employees; no team (or a team with no manager) => all employees.
    let audience = accessTeamIds.length ? await findTeamManagers(accessTeamIds) : [];
    if (!audience.length) audience = await findTriagers();
    await notifyPeople({ userIds: audience.map((u) => u.id), actorId: req.currentUser.id, type: 'ASSIGNMENT', title: `New client ticket ${t.key} (${org.name})`, body: `${req.currentUser.name || req.currentUser.email} raised: ${t.title}`, href: ticketUrl(t) });
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
  const parsed = parseBody(ticketUpdate, req.body);
  const { teamIds, ...data } = parsed;
  const scope = ticketEditScope(req, old);
  const forbidden = Object.keys(data).filter((k) => !TICKET_FIELDS[scope].includes(k));
  if (scope === 'none' || forbidden.length) {
    throw new AppError(scope === 'none' ? "You can't edit this ticket." : `Your role can't change: ${forbidden.join(', ')}.`, 403);
  }
  if (data.status !== undefined && req.isInternal && !req.can('ticket.triage')) {
    const emp = await employeeIds(prisma, [old.requesterId]);
    if (finishBlocked({ internal: true, canTriage: false, status: data.status, requesterIsEmployee: emp.has(old.requesterId) })) throw new AppError(NEEDS_MANAGER_REVIEW_MESSAGE, 403, 'NEEDS_MANAGER_REVIEW');
  }
  if (req.isInternal && data.status && old.visibility === 'CLIENT') {
    const requesterIsEmployee = (await employeeIds(prisma, [old.requesterId])).has(old.requesterId);
    if (!requesterIsEmployee && data.status === 'CLOSED') throw new AppError('Employees cannot close client tickets. Move the ticket to Resolved/Review so the client can review and approve it.', 403, 'CLIENT_APPROVAL_REQUIRED');
    if (!requesterIsEmployee && data.status === 'RESOLVED') data.status = 'CLIENT_REVIEW';
  }
  if (['RESOLVED', 'CLOSED', 'CLIENT_REVIEW'].includes(data.status)) await assertTicketWorkComplete(old.id);
  if (scope === 'client' && data.status !== undefined && !clientStatusChangeAllowed(old.status, data.status)) {
    throw new AppError('You can only approve or send back a ticket that is waiting for your review.', 403, 'CLIENT_STATUS_LOCKED');
  }
  await assertProjectInOrg(data.projectId, old.organizationId);
  await assertAssignable(data.assigneeId);
  await assertInternalTeam(data.teamId);
  const nextOwnerTeamId = data.teamId !== undefined ? data.teamId : old.teamId;
  const existingParticipants = (old.teamAccesses || []).filter((a) => a.teamId !== old.teamId).map((a) => a.teamId);
  const nextAccessIds = accessTeamIdsFor(nextOwnerTeamId, teamIds !== undefined ? teamIds : existingParticipants);
  if (teamIds && !req.can('ticket.triage')) throw new AppError('Only authorized triagers can change participating teams.', 403);
  if (nextAccessIds.length) {
    const valid = await prisma.team.findMany({ where: { id: { in: nextAccessIds }, organization: { type: 'INTERNAL' } }, select: { id: true } });
    if (valid.length !== nextAccessIds.length) throw new AppError('One or more participating teams are invalid.', 400, 'INVALID_TEAM');
  }
  // Team first, then assignee. Changing the team clears an assignee who is not in the new team.
  const routingTouched = data.teamId !== undefined || teamIds !== undefined;
  let autoUnassigned = false;
  if (req.isInternal && (data.assigneeId !== undefined || routingTouched)) {
    const plan = planAssignee({ old, data, accessIds: nextAccessIds, membersByTeam: await loadTeamMemberIds(nextAccessIds), routingTouched });
    if (plan.error) throw new AppError(plan.error.message, plan.error.status, plan.error.code);
    if (plan.assigneeId !== undefined) data.assigneeId = plan.assigneeId;
    autoUnassigned = plan.autoUnassigned;
  }

  const t = await prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.update({ where: { id: old.id }, data });
    if (teamIds || (data.teamId !== undefined && data.teamId !== old.teamId)) {
      // Diff instead of delete-all so the people who routed the ticket keep their `addedById` trail (and their visibility).
      const wanted = accessTeamIdsFor(updated.teamId, teamIds !== undefined ? teamIds : existingParticipants);
      await tx.ticketTeamAccess.deleteMany({ where: { ticketId: old.id, teamId: { notIn: wanted.length ? wanted : ['__none__'] } } });
      for (const teamId of wanted) {
        const accessRole = teamId === updated.teamId ? 'OWNER' : 'PARTICIPANT';
        await tx.ticketTeamAccess.upsert({
          where: { ticketId_teamId: { ticketId: old.id, teamId } },
          create: { ticketId: old.id, teamId, accessRole, addedById: req.currentUser.id },
          update: { accessRole },
        });
      }
    }
    await syncTaskFromTicket(tx, updated, { prevAssigneeId: old.assigneeId, changed: [...Object.keys(data), ...(teamIds ? ['teamIds'] : [])], actor: req.currentUser });
    return updated;
  });
  if (t.assigneeId && t.assigneeId !== old.assigneeId) {
    await notifyAssignment({ userId: t.assigneeId, actor: req.currentUser, title: `${t.key} — ${t.title}`, kind: 'ticket', href: ticketUrl(t) });
  }
  if (data.status === 'REVIEW' && old.status !== 'REVIEW' && !req.can('ticket.triage')) await notifyReviewReady(t, req.currentUser);
  {
    const oldIds = (old.teamAccesses || []).map((a) => a.teamId);
    const newIds = routingTouched ? nextAccessIds : oldIds;
    const names = await loadNames({ userIds: [old.assigneeId, t.assigneeId], teamIds: [...oldIds, ...newIds, old.teamId, t.teamId], projectIds: [old.projectId, t.projectId] });
    const events = diffTicketEvents({ old, updated: t, oldTeamIds: oldIds, newTeamIds: newIds, names });
    if (autoUnassigned) events.forEach((e) => { if (e.type === 'ASSIGNEE') e.note = 'Cleared automatically: not a member of the new team'; });
    await recordTicketEvents(prisma, t.id, req.currentUser.id, events);
  }
  await ticketLog(req, t, 'updated', autoUnassigned ? `Updated ticket ${t.key} (team changed, assignee cleared because they are not in the new team)` : `Updated ticket ${t.key}`);
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
  res.json({ ...t, autoUnassigned });
});

// Per-ticket history: who changed what, and when. Clients only get client-visible events (status shown in client wording).
router.get('/tickets/:id/history', async (req, res) => {
  const t = await loadVisibleTicket(req);
  const rows = await prisma.ticketEvent.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: 'desc' }, take: 300 });
  const events = req.can('ticket.view_internal') ? rows : clientView([...rows].reverse()).reverse();
  const actorIds = [...new Set(events.map((e) => e.actorId).filter(Boolean))];
  const people = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true, memberships: { where: { isActive: true }, select: { role: true, organization: { select: { type: true } } } } } })
    : [];
  const byId = Object.fromEntries(people.map((u) => {
    const m = u.memberships.find((x) => x.organization?.type === 'INTERNAL') || u.memberships[0];
    return [u.id, { id: u.id, name: u.name, email: u.email, role: m?.role || null }];
  }));
  res.json(events.map((e) => ({ ...e, actor: e.actorId ? byId[e.actorId] || null : null })));
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

// Delete a ticket raised by mistake. Managers/admins: any visible ticket. The requester: only while it is still untouched.
router.delete('/tickets/:id', async (req, res) => {
  const t = await loadVisibleTicket(req);
  const othersCommented = (await prisma.comment.count({ where: { ticketId: t.id, authorId: { not: req.currentUser.id } } })) > 0;
  if (!canDeleteTicket({ canDeleteAny: req.can('ticket.delete'), isRequester: t.requesterId === req.currentUser.id, status: t.status, assigneeId: t.assigneeId, othersCommented })) {
    throw new AppError('You can delete a ticket you raised only while it is still Open, unassigned and without replies. Ask a manager to delete it.', 403, 'TICKET_NOT_DELETABLE');
  }
  const files = await prisma.attachment.findMany({ where: { ticketId: t.id }, select: { storageKey: true } });
  const detached = await prisma.task.count({ where: { ticketId: t.id, autoCreated: false } });
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { ticketId: t.id, autoCreated: true } }), // its mirror task goes with it; manual tasks are kept, detached
    prisma.ticket.delete({ where: { id: t.id } }),
  ]);
  await Promise.all(files.map((f) => fs.unlink(nodePath.join(nodePath.resolve(env.uploadDir), nodePath.basename(f.storageKey))).catch(() => {})));
  await ticketLog(req, t, 'deleted', `Deleted ticket ${t.key}: ${t.title}`);
  if (t.assigneeId) await notifyPeople({ userIds: [t.assigneeId], actorId: req.currentUser.id, type: 'SYSTEM', title: `${t.key} was deleted`, body: `${req.currentUser.name || req.currentUser.email} deleted it (${t.title}).`, href: '/tickets' });
  res.json({ ok: true, detachedTasks: detached });
});

router.get('/tickets/:id/attachments', async (req, res) => {
  const t = await loadVisibleTicket(req);
  res.json(await prisma.attachment.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: 'desc' }, select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadedById: true } }));
});

router.post('/tickets/:id/comments', async (req, res) => {
  const t = await loadVisibleTicket(req);
  const data = parseBody(commentCreate, req.body);
  if (data.visibility === 'INTERNAL' && !req.can('ticket.comment_internal')) throw new AppError('Internal comment permission required', 403);
  const c = await prisma.comment.create({ data: { ...data, ticketId: t.id, authorId: req.currentUser.id }, include: authorSelect });
  await recordTicketEvents(prisma, t.id, req.currentUser.id, [{ type: 'COMMENT', toValue: c.id, note: data.body.slice(0, 140), clientVisible: data.visibility === 'CLIENT' }]);
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
