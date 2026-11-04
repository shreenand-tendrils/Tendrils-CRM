// Ticket domain logic: client vs staff routing rules, team-first assignee planning,
// lifecycle/status transitions, history events, comments and notifications.
// `ctx` is the request's auth context ({ currentUser, memberships, isInternal, can, ... })
// — never req/res, which stay in routes.
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { ticketScope, canSeeOrg } from '../rbac/scope.js';
import { storagePath, discard } from './storage.js';
import { canViewTicket, ticketEditScope, TICKET_FIELDS, clientStatusChangeAllowed } from '../rbac/policies.js';
import { logActivity } from './activity.js';
import { notifyAssignment } from './assignment.service.js';
import { notifyPeople, findTriagers, findTeamManagers } from './notify.service.js';
import { assertDueNotPast, assertAssignable, assertProjectInOrg, assertInternalTeam, loadTeamMemberIds } from './guards.js';
import { syncTaskFromTicket, assertTicketWorkComplete } from './ticketTask.service.js';
import { recordTicketEvents, loadNames } from './ticketHistory.service.js';
import { diffTicketEvents, clientView } from './ticketEvents.js';
import { accessTeamIdsFor, isMemberOfAnyTeam, planAssignee, normalizeTeamPicks } from './ticketRouting.js';
import { canDeleteTicket, reviewTaskAsClient } from './review.js';
import { AppError } from '../errors/AppError.js';

const authorSelect = { author: { select: { id: true, name: true, email: true } } };
const ticketUrl = (t) => `/?ticket=${t.id}`;
const nice = (v) => String(v).replaceAll('_', ' ').toLowerCase();

/** Keep the right people in the loop. Clients only ever hear about CLIENT-visible events. */
/** Which of these users are employees (active member of the internal workspace)? Used for team-to-team tickets. */
async function employeeIdSet(ids) {
  const u = [...new Set((ids || []).filter(Boolean))];
  if (!u.length) return new Set();
  const rows = await prisma.membership.findMany({ where: { userId: { in: u }, isActive: true, organization: { type: 'INTERNAL' } }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

async function notifyTicket(ctx, t, { title, body, toRequester = false, requesterIsEmployee = false }) {
  const requesterIsClient = t.requesterId && t.requesterId !== t.assigneeId && (t.visibility === 'CLIENT' || requesterIsEmployee);
  const staff = t.assigneeId ? [t.assigneeId] : (await findTriagers()).map((u) => u.id);
  const ids = toRequester ? (requesterIsClient ? [t.requesterId] : []) : staff;
  await notifyPeople({ userIds: ids, actorId: ctx.currentUser.id, type: 'STATUS_CHANGE', title, body, href: ticketUrl(t) });
}

async function loadVisibleTicket(ctx, id) {
  const t = await prisma.ticket.findUnique({ where: { id }, include: { teamAccesses: { select: { teamId: true, accessRole: true, addedById: true } } } });
  if (!t || !canViewTicket(ctx, t)) throw new AppError('Ticket not found', 404); // hide existence
  return t;
}

const ticketLog = (ctx, t, action, summary) =>
  logActivity({
    actorId: ctx.currentUser.id, organizationId: t.organizationId, entityType: 'ticket', entityId: t.id, action, summary,
    metadata: { visibility: t.visibility, requesterId: t.requesterId },
  });

export async function listTickets(ctx, query) {
  const q = query.q ? String(query.q) : '';
  const search = q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { key: { contains: q, mode: 'insensitive' } }] } : {};
  const rows = (
    await prisma.ticket.findMany({
      where: { AND: [ticketScope(ctx), search] }, orderBy: { updatedAt: 'desc' }, take: 150,
      include: {
        organization: { select: { id: true, name: true, type: true } },
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true, email: true } },
        requester: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true, tasks: true, attachments: { where: { inline: false } } } },
        // Team names are safe client-facing routing metadata: clients need to see which team owns each request.
        teamAccesses: { include: { team: { select: { id: true, name: true, slug: true } } } },
        // the linked work item is internal: clients never see it
        ...(ctx.isInternal ? { tasks: { select: { id: true, status: true, autoCreated: true, assigneeId: true, assignees: { select: { userId: true } } } } } : {}),
      },
    })
  );
  // How many top-level tasks of each ticket wait for review (clients see these as "ready for your review").
  const waiting = rows.length ? await prisma.task.groupBy({ by: ['ticketId'], where: { ticketId: { in: rows.map((r) => r.id) }, status: 'REVIEW', autoCreated: false, parentId: null }, _count: { _all: true } }) : [];
  const byTicket = Object.fromEntries(waiting.map((w) => [w.ticketId, w._count._all]));
  const emp = ctx.isInternal ? await employeeIdSet(rows.map((r) => r.requesterId)) : new Set();
  return rows.map((r) => ({ ...r, tasksInReview: byTicket[r.id] || 0, requesterIsEmployee: emp.has(r.requesterId) }));
}

/** Sequential, permanent keys per organisation prefix (TEN-0001, TEN-0002, ...). The counter row is locked by the upsert,
 *  so concurrent creates get distinct numbers; a rolled-back create rolls the number back too (no gaps). Old keys are untouched. */
async function createWithUniqueKey(data, slug, client = prisma) {
  const prefix = slug.slice(0, 3).toUpperCase();
  for (let i = 0; i < 5; i++) {
    const [{ lastNumber }] = await client.$queryRaw`INSERT INTO "TicketCounter" ("prefix", "lastNumber") VALUES (${prefix}, 1) ON CONFLICT ("prefix") DO UPDATE SET "lastNumber" = "TicketCounter"."lastNumber" + 1 RETURNING "lastNumber"`;
    const key = `${prefix}-${String(lastNumber).padStart(4, '0')}`;
    if (await client.ticket.findUnique({ where: { key }, select: { id: true } })) continue; // already used by an older ticket: take the next number
    return client.ticket.create({ data: { ...data, key } });
  }
  throw new AppError('Could not allocate a ticket key, please retry', 503);
}

export async function createTicket(ctx, input) {
  let { teamIds = [], ...data } = input;
  if (!canSeeOrg(ctx, data.organizationId)) throw new AppError('Organization access denied', 403);
  if (!ctx.isInternal && data.visibility === 'INTERNAL') throw new AppError('Only staff can create internal-only tickets', 403);
  // Clients choose the initial owning team; that team's employees pick up the OPEN, unassigned ticket.
  const clientPicks = !ctx.isInternal ? normalizeTeamPicks(data.teamId, teamIds) : null;
  if (clientPicks) {
    const ids = [clientPicks.teamId, ...clientPicks.teamIds].filter(Boolean);
    if (!clientPicks.teamId) throw new AppError('Choose a team so the request enters the correct team queue.', 400, 'TEAM_REQUIRED');
    if (ids.length) {
      const ok = await prisma.team.count({ where: { id: { in: ids }, isActive: true, clientVisible: true, organization: { type: 'INTERNAL' } } });
      if (ok !== ids.length) throw new AppError('Pick one of the teams offered in the list.', 400, 'INVALID_TEAM');
    }
    data = { ...data, teamId: clientPicks.teamId || undefined };
    teamIds = clientPicks.teamIds;
  }
  const crossTeam = ctx.can('ticket.triage') || ctx.can('ticket.route') || ctx.can('work.cross_team');
  if (!crossTeam && data.assigneeId && data.assigneeId !== ctx.currentUser.id) {
    throw new AppError("You don't have permission to assign tickets to others (ticket.triage).", 403);
  }
  const ownTeamIds = [...new Set(ctx.memberships.flatMap((m) => (m.teamMemberships || []).map((tm) => tm.teamId)))];
  if (ctx.isInternal && !ctx.can('ticket.triage')) {
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
  if (ctx.isInternal && data.assigneeId) {
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
    const created = await createWithUniqueKey({ ...data, requesterId: ctx.currentUser.id }, org.slug, tx);
    const ids = [...new Set([...(data.teamId ? [data.teamId] : []), ...teamIds])];
    if (ids.length) await tx.ticketTeamAccess.createMany({ data: ids.map((teamId) => ({ ticketId: created.id, teamId, accessRole: teamId === data.teamId ? 'OWNER' : 'PARTICIPANT', addedById: ctx.currentUser.id })), skipDuplicates: true });
    return created;
  });
  await ticketLog(ctx, t, 'created', `Created ticket ${t.key}: ${t.title}`);
  {
    const base = { title: t.title, description: t.description, status: t.status, priority: t.priority, dueDate: t.dueDate, visibility: t.visibility, projectId: t.projectId, teamId: null, assigneeId: null };
    const names = await loadNames({ userIds: [t.assigneeId], teamIds: accessTeamIds });
    await recordTicketEvents(prisma, t.id, ctx.currentUser.id, [
      { type: 'CREATED', note: t.key, clientVisible: true },
      ...diffTicketEvents({ old: base, updated: t, oldTeamIds: [], newTeamIds: accessTeamIds, names }).filter((e) => ['TEAM', 'ASSIGNEE', 'TEAM_ACCESS'].includes(e.type)),
    ]);
  }
  // Staff who route a ticket to another team notify the destination team's employees.
  if (ctx.isInternal && accessTeamIds.some((id) => !ownTeamIds.includes(id))) {
    const destinationTeam = await findTeamManagers(accessTeamIds.filter((id) => !ownTeamIds.includes(id)));
    await notifyPeople({ userIds: destinationTeam.map((u) => u.id), actorId: ctx.currentUser.id, type: 'ASSIGNMENT', title: `${t.key} was sent to your team`, body: `${ctx.currentUser.name || ctx.currentUser.email} sent a ticket to your team: "${t.title}" (${t.key}, priority ${String(t.priority || 'MEDIUM').toLowerCase()}).\nAnyone on the team can pick it up - open it and assign it to yourself to start.`, href: ticketUrl(t) });
  }
  // A client request stays OPEN and unassigned until an employee of its chosen team picks it up.
  if (!ctx.isInternal) {
    const audience = accessTeamIds.length ? await findTeamManagers(accessTeamIds) : [];
    await notifyPeople({ userIds: audience.map((u) => u.id), actorId: ctx.currentUser.id, type: 'ASSIGNMENT', title: `New client ticket ${t.key} (${org.name})`, body: `${ctx.currentUser.name || ctx.currentUser.email} from ${org.name} raised a new ticket: "${t.title}" (${t.key}, priority ${String(t.priority || 'MEDIUM').toLowerCase()}).\nIt is waiting for someone on your team to pick it up.`, href: ticketUrl(t) });
  }

  // Assigned ticket => work item for the assignee, automatically.
  let task = null;
  if (t.assigneeId) {
    try {
      task = await prisma.$transaction((tx) => syncTaskFromTicket(tx, t, { changed: ['ALL'], actor: ctx.currentUser }));
    } catch (e) {
      console.error(`[ticket→task] could not create task for ${t.key}:`, e.message); // `npm run backfill:tasks` repairs this
    }
    await notifyAssignment({ userId: t.assigneeId, actor: ctx.currentUser, title: `${t.key} — ${t.title}`, kind: 'ticket', href: ticketUrl(t) });
  }
  return { ...t, task: task && { id: task.id, status: task.status } };
}

export async function patchTicket(ctx, id, input) {
  const old = await loadVisibleTicket(ctx, id);
  const { teamIds, ...data } = input;
  const scope = ticketEditScope(ctx, old);
  const forbidden = Object.keys(data).filter((k) => !TICKET_FIELDS[scope].includes(k));
  if (scope === 'none' || forbidden.length) {
    throw new AppError(scope === 'none' ? "You can't edit this ticket." : `Your role can't change: ${forbidden.join(', ')}.`, 403);
  }
  // Client tickets: employees submit for client review. Team-to-team tickets (raised by an employee): the person who raised it
  // reviews and approves (or sends back), exactly like a client would. Admins/triagers can always close.
  const reqEmp = (await employeeIdSet([old.requesterId])).has(old.requesterId);
  const isRequester = old.requesterId === ctx.currentUser.id;
  if (ctx.isInternal && !ctx.can('ticket.triage') && data.status === 'CLOSED' && data.status !== old.status && !(reqEmp && isRequester)) {
    throw new AppError(reqEmp ? 'Submit it for review (Review/Test). The person who raised this ticket approves and closes it.' : 'Employees cannot mark a ticket as done. Submit it for client review instead.', 403, 'CLIENT_REVIEW_REQUIRED');
  }
  if (['REVIEW_TEST', 'CLOSED'].includes(data.status) && data.status !== old.status) await assertTicketWorkComplete(prisma, old.id);
  if (scope === 'client' && data.status !== undefined && !clientStatusChangeAllowed(old.status, data.status)) {
    throw new AppError('You can only approve or send back a ticket that is waiting for your review.', 403, 'CLIENT_STATUS_LOCKED');
  }
  assertDueNotPast(data.dueDate, old.dueDate);
  await assertProjectInOrg(data.projectId, old.organizationId);
  await assertAssignable(data.assigneeId);
  await assertInternalTeam(data.teamId);
  const nextOwnerTeamId = data.teamId !== undefined ? data.teamId : old.teamId;
  const existingParticipants = (old.teamAccesses || []).filter((a) => a.teamId !== old.teamId).map((a) => a.teamId);
  const nextAccessIds = accessTeamIdsFor(nextOwnerTeamId, teamIds !== undefined ? teamIds : existingParticipants);
  if (teamIds && !ctx.can('ticket.triage') && !ctx.can('ticket.route')) throw new AppError('Only team members routing this ticket or an admin can change participating teams.', 403);
  if (nextAccessIds.length) {
    const valid = await prisma.team.findMany({ where: { id: { in: nextAccessIds }, organization: { type: 'INTERNAL' } }, select: { id: true } });
    if (valid.length !== nextAccessIds.length) throw new AppError('One or more participating teams are invalid.', 400, 'INVALID_TEAM');
  }
  // Team first, then assignee. Changing the team clears an assignee who is not in the new team.
  const routingTouched = data.teamId !== undefined || teamIds !== undefined;
  let autoUnassigned = false;
  if (ctx.isInternal && (data.assigneeId !== undefined || routingTouched)) {
    const plan = planAssignee({ old, data, accessIds: nextAccessIds, membersByTeam: await loadTeamMemberIds(nextAccessIds), routingTouched });
    if (plan.error) throw new AppError(plan.error.message, plan.error.status, plan.error.code);
    if (plan.assigneeId !== undefined) data.assigneeId = plan.assigneeId;
    autoUnassigned = plan.autoUnassigned;
  }

  // Keep the lifecycle timestamp authoritative for analytics. Client approval closes
  // tickets through this patch path; without this field the live status becomes CLOSED
  // while the period-based "closed" KPI remains zero.
  if (data.status === 'CLOSED' && old.status !== 'CLOSED') data.closedAt = new Date();
  else if (data.status && data.status !== 'CLOSED' && old.status === 'CLOSED') data.closedAt = null;

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
          create: { ticketId: old.id, teamId, accessRole, addedById: ctx.currentUser.id },
          update: { accessRole },
        });
      }
    }
    await syncTaskFromTicket(tx, updated, { prevAssigneeId: old.assigneeId, changed: [...Object.keys(data), ...(teamIds ? ['teamIds'] : [])], actor: ctx.currentUser });
    return updated;
  });
  if (t.assigneeId && t.assigneeId !== old.assigneeId) {
    await notifyAssignment({ userId: t.assigneeId, actor: ctx.currentUser, title: `${t.key} — ${t.title}`, kind: 'ticket', href: ticketUrl(t) });
  }
  {
    const oldIds = (old.teamAccesses || []).map((a) => a.teamId);
    const newIds = routingTouched ? nextAccessIds : oldIds;
    const names = await loadNames({ userIds: [old.assigneeId, t.assigneeId], teamIds: [...oldIds, ...newIds, old.teamId, t.teamId], projectIds: [old.projectId, t.projectId] });
    const events = diffTicketEvents({ old, updated: t, oldTeamIds: oldIds, newTeamIds: newIds, names });
    if (autoUnassigned) events.forEach((e) => { if (e.type === 'ASSIGNEE') e.note = 'Cleared automatically: not a member of the new team'; });
    await recordTicketEvents(prisma, t.id, ctx.currentUser.id, events);
  }
  await ticketLog(ctx, t, 'updated', autoUnassigned ? `Updated ticket ${t.key} (team changed, assignee cleared because they are not in the new team)` : `Updated ticket ${t.key}`);
  if (data.status && data.status !== old.status) {
    const requesterReviewing = reqEmp && isRequester && old.status === 'REVIEW_TEST' && ['CLOSED', 'OPEN'].includes(data.status);
    if (ctx.isInternal && !requesterReviewing) {
      await notifyTicket(ctx, t, {
        toRequester: true, requesterIsEmployee: reqEmp,
        title: data.status === 'REVIEW_TEST' ? `${t.key} is ready for your review` : data.status === 'REVIEW_HELP' ? `${t.key} needs more information from you` : `${t.key} is now ${nice(data.status)}`,
        body: data.status === 'REVIEW_HELP' ? `The team needs more information to continue on "${t.title}" (${t.key}). Please open the ticket and reply in the comments.` : data.status === 'REVIEW_TEST' ? `The team has finished work on "${t.title}" (${t.key}). Please review it, then approve it to close the ticket or send it back with a comment on what to change.` : `"${t.title}" (${t.key}) is now ${nice(data.status)}.`,
      });
    } else {
      await notifyTicket(ctx, t, { title: `${t.key}: ${ctx.isInternal ? 'requester' : 'client'} ${data.status === 'CLOSED' ? 'approved' : 'sent back'} the work`, body: `${ctx.currentUser.name || ctx.currentUser.email} ${data.status === 'CLOSED' ? 'approved the work on' : 'asked for changes on'} "${t.title}" (${t.key}).${data.status === 'CLOSED' ? ' The ticket is now closed.' : ' Please check the latest comment and continue.'}` });
    }
  }
  return { ...t, autoUnassigned, requesterIsEmployee: reqEmp };
}

// Per-ticket history: who changed what, and when. Clients only get client-visible events (status shown in client wording).
export async function getTicketHistory(ctx, id) {
  const t = await loadVisibleTicket(ctx, id);
  const rows = await prisma.ticketEvent.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: 'desc' }, take: 300 });
  const events = ctx.can('ticket.view_internal') ? rows : clientView([...rows].reverse()).reverse();
  const actorIds = [...new Set(events.map((e) => e.actorId).filter(Boolean))];
  const people = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true, memberships: { where: { isActive: true }, select: { role: true, organization: { select: { type: true } } } } } })
    : [];
  const byId = Object.fromEntries(people.map((u) => {
    const m = u.memberships.find((x) => x.organization?.type === 'INTERNAL') || u.memberships[0];
    return [u.id, { id: u.id, name: u.name, email: u.email, role: m?.role || null }];
  }));
  return events.map((e) => ({ ...e, actor: e.actorId ? byId[e.actorId] || null : null }));
}

export async function listTicketComments(ctx, id) {
  const t = await loadVisibleTicket(ctx, id);
  return prisma.comment.findMany({
    where: { ticketId: t.id, ...(ctx.can('ticket.view_internal') ? {} : { visibility: 'CLIENT' }) },
    orderBy: { createdAt: 'asc' }, include: authorSelect,
  });
}

// Delete a ticket raised by mistake. Managers/admins: any visible ticket. The requester: only while it is still untouched.
export async function deleteTicket(ctx, id) {
  const t = await loadVisibleTicket(ctx, id);
  const othersCommented = (await prisma.comment.count({ where: { ticketId: t.id, authorId: { not: ctx.currentUser.id } } })) > 0;
  if (!canDeleteTicket({ canDeleteAny: ctx.can('ticket.delete'), isRequester: t.requesterId === ctx.currentUser.id, status: t.status, assigneeId: t.assigneeId, othersCommented })) {
    throw new AppError('You can delete a ticket you raised only while it is still Open, unassigned and without replies. Ask a manager to delete it.', 403, 'TICKET_NOT_DELETABLE');
  }
  const files = await prisma.attachment.findMany({ where: { ticketId: t.id }, select: { storageKey: true } });
  const detached = await prisma.task.count({ where: { ticketId: t.id, autoCreated: false } });
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { ticketId: t.id, autoCreated: true } }), // its mirror task goes with it; manual tasks are kept, detached
    prisma.ticket.delete({ where: { id: t.id } }),
  ]);
  await Promise.all(files.map((f) => discard(storagePath(f.storageKey))));
  await ticketLog(ctx, t, 'deleted', `Deleted ticket ${t.key}: ${t.title}`);
  if (t.assigneeId) await notifyPeople({ userIds: [t.assigneeId], actorId: ctx.currentUser.id, type: 'SYSTEM', title: `${t.key} was deleted`, body: `${ctx.currentUser.name || ctx.currentUser.email} deleted it (${t.title}).`, href: '/tickets' });
  return { detachedTasks: detached };
}

// Everyone who can open the ticket (clients included) can see the work items behind it, read-only. Internal comments stay internal.
export async function listTicketTasks(ctx, id) {
  const t = await loadVisibleTicket(ctx, id);
  return prisma.task.findMany({
    where: { ticketId: t.id, autoCreated: false }, orderBy: { createdAt: 'asc' }, // the auto-created mirror record is plumbing, never shown
    select: {
      id: true, title: true, description: true, status: true, priority: true, dueDate: true, createdAt: true, completedAt: true, parentId: true, autoCreated: true,
      team: { select: { id: true, name: true } }, assignees: { select: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
}

// Client review of one task: approve it, or send it back with what to change. The last approval closes the ticket.
export async function reviewTicketTask(ctx, ticketId, taskId, input) {
  const t = await loadVisibleTicket(ctx, ticketId);
  if (ctx.isInternal || ticketEditScope(ctx, t) !== 'client') throw new AppError('Only the client who raised this ticket can review its tasks.', 403, 'CLIENT_ONLY');
  const { decision, note } = input;
  const out = await reviewTaskAsClient({ ticket: t, taskId, decision, note, actor: ctx.currentUser });
  return { task: { id: out.task.id, status: out.task.status }, ticketStatus: out.ticket.status, allApproved: !!out.allApproved, closed: !!out.closed };
}

export async function listTicketAttachments(ctx, id) {
  const t = await loadVisibleTicket(ctx, id);
  return prisma.attachment.findMany({ where: { ticketId: t.id, inline: false }, orderBy: { createdAt: 'desc' }, select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadedById: true } });
}

export async function addTicketComment(ctx, id, input) {
  const t = await loadVisibleTicket(ctx, id);
  const data = input;
  if (data.visibility === 'INTERNAL' && !ctx.can('ticket.comment_internal')) throw new AppError('Internal comment permission required', 403);
  const c = await prisma.comment.create({ data: { ...data, ticketId: t.id, authorId: ctx.currentUser.id }, include: authorSelect });
  await recordTicketEvents(prisma, t.id, ctx.currentUser.id, [{ type: 'COMMENT', toValue: c.id, note: data.body.slice(0, 140), clientVisible: data.visibility === 'CLIENT' }]);
  await logActivity({
    actorId: ctx.currentUser.id, organizationId: t.organizationId, entityType: 'ticket', entityId: t.id,
    action: 'commented', summary: `Comment added to ${t.key}`,
    metadata: { visibility: data.visibility === 'INTERNAL' ? 'INTERNAL' : t.visibility, requesterId: t.requesterId },
  });
  {
    const internalNote = data.visibility === 'INTERNAL';
    const earlier = await prisma.comment.findMany({ where: { ticketId: t.id, ...(internalNote ? {} : { visibility: { not: 'INTERNAL' } }) }, select: { authorId: true }, distinct: ['authorId'] });
    let ids = [t.assigneeId, t.requesterId, ...earlier.map((e) => e.authorId)].filter(Boolean);
    if (!t.assigneeId) { // nobody owns it yet: the team's people (or admins) hear about it
      const teamIds = [t.teamId, ...(t.teamAccesses || []).map((a) => a.teamId)].filter(Boolean);
      ids.push(...(teamIds.length ? await findTeamManagers(teamIds) : await findTriagers()).map((u) => u.id));
    }
    if (internalNote) { const emp = await employeeIdSet(ids); ids = ids.filter((id) => emp.has(id)); } // internal notes never reach clients
    await notifyPeople({ userIds: ids, actorId: ctx.currentUser.id, type: 'COMMENT', title: `${internalNote ? 'New internal note' : 'New comment'} on ${t.key}: ${t.title}`, href: ticketUrl(t), body: `${ctx.currentUser.name || ctx.currentUser.email} ${internalNote ? 'added an internal note on' : 'commented on'} \"${t.title}\" (${t.key}):\n\"${data.body.slice(0, 200)}\"` });
  }
  return c;
}
