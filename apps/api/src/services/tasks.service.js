// Task domain logic: team routing, assignee rules, the review ladder, ticket sync,
// comments and notifications. `ctx` is the request's auth context
// ({ currentUser, memberships, isInternal, can, ... }) — never req/res, which stay in routes.
import { prisma } from '../db.js';
import { orgScope, canSeeOrg, taskTeamScope, ticketScope } from '../rbac/scope.js';
import { canEditTask } from '../rbac/policies.js';
import { logActivity } from './activity.js';
import { notifyAssignment } from './assignment.service.js';
import { notifyPeople, findTeamManagers } from './notify.service.js';
import { assertAssignees, assertProjectInOrg, assertTicketInOrg, loadTeamMemberIds } from './guards.js';
import { syncTaskFromTicket, syncTicketFromTask, assertTaskSubtasksDone } from './ticketTask.service.js';
import { recordTicketEvents } from './ticketHistory.service.js';
import { assigneesOutsideTeams } from './ticketRouting.js';
import { resolveAssignees, taskCommentRecipients, canApproveTask, taskReviewerTeamIds, reviewAuthorityOf, canFinishTask, REVIEW_HINT, recordClientReviewRequest } from './review.js';
import { AppError } from '../errors/AppError.js';

const userSelect = { id: true, name: true, email: true, image: true };
const include = {
  organization: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  ticket: { select: { id: true, key: true, title: true, status: true, visibility: true, organization: { select: { type: true } } } },
  parent: { select: { id: true, title: true, status: true } },
  team: { select: { id: true, name: true } },
  teamAccesses: { include: { team: { select: { id: true, name: true } } } },
  assignee: { select: userSelect },
  assignees: { include: { user: { select: userSelect } } },
  creator: { select: userSelect },
  _count: { select: { comments: true, attachments: { where: { inline: false } } } },
};
const asRows = (ids) => ids.map((userId) => ({ userId }));
const link = (t) => `/?task=${t.id}`;

// Tasks are internal work items: clients get an empty list (so the shared workspace
// load still succeeds) and cannot create or edit them.
export async function listTasks(ctx, query) {
  if (!ctx.isInternal) return [];
  const mine = query.mine === 'true' ? { OR: [{ assigneeId: ctx.currentUser.id }, { assignees: { some: { userId: ctx.currentUser.id } } }] } : {};
  const rows = await prisma.task.findMany({ where: { AND: [orgScope(ctx), taskTeamScope(ctx), mine] }, orderBy: [{ position: 'asc' }, { updatedAt: 'desc' }], take: 300, include });
  // `reviewBy` tells the UI who reviews each task (see services/review.js), so the screen never guesses.
  return rows.map((t) => ({
    ...t,
    reviewBy: reviewAuthorityOf({
      autoCreated: t.autoCreated, parentId: t.parentId, ticketIsClient: t.ticket?.organization?.type === 'CLIENT' && t.ticket?.visibility === 'CLIENT',
      reviewerTeamIds: t.teamAccesses.filter((a) => a.accessRole === 'REVIEWER').map((a) => a.teamId), creatorId: t.creatorId,
      assigneeIds: [...new Set([t.assigneeId, ...t.assignees.map((a) => a.userId)].filter(Boolean))],
    }),
  }));
}

export async function createTask(ctx, input) {
  const { assigneeIds, assigneeId, teamIds = [], parentId, ...data } = input;
  if (['REVIEW', 'DONE'].includes(data.status)) throw new AppError('A new task starts in To do or In progress. Its status is changed by the person it is assigned to.', 400, 'NEW_TASK_STATUS');
  let ids = resolveAssignees({ assigneeIds, assigneeId }) ?? [];
  const me = ctx.currentUser.id;
  const cross = ctx.can('task.assign') || ctx.can('work.cross_team'); // may send work to other teams
  if (!cross && ids.some((id) => id !== me)) throw new AppError("You don't have permission to assign tasks to others (task.assign).", 403);
  if (!ctx.can('task.assign') && !ids.length) ids = [me]; // employees' own tasks default to themselves (dropped below if the task goes to another team)
  if (!canSeeOrg(ctx, data.organizationId)) throw new AppError('Organization access denied', 403);
  await assertProjectInOrg(data.projectId, data.organizationId);
  await assertTicketInOrg(data.ticketId, data.organizationId);
  await assertAssignees(ids);
  if (parentId) {
    const parent = await prisma.task.findFirst({ where: { id: parentId, organizationId: data.organizationId, ...taskTeamScope(ctx) }, select: { id: true, status: true, autoCreated: true, ticketId: true, projectId: true } });
    if (!parent) throw new AppError('Parent task not found or not accessible.', 404);
    if (parent.autoCreated) throw new AppError('This record mirrors its ticket. Add a linked task to the ticket instead of a subtask.', 400, 'MIRROR_NO_SUBTASKS');
    if (['REVIEW', 'DONE'].includes(parent.status)) throw new AppError('Move the parent task back to In progress before adding subtasks.', 409, 'PARENT_IN_REVIEW');
    // A subtask always belongs to the same ticket/project as its parent so the ticket rolls up all of its work.
    if (!data.ticketId && parent.ticketId) data.ticketId = parent.ticketId;
    if (!data.projectId && parent.projectId) data.projectId = parent.projectId;
  }
  if (teamIds.length && !cross) throw new AppError('Only authorized task assigners can distribute work across teams.', 403);
  const ownTeamIds = [...new Set(ctx.memberships.flatMap((m) => (m.teamMemberships || []).map((tm) => tm.teamId)))];
  if (!ctx.can('task.assign')) {
    if (!cross && data.teamId && !ownTeamIds.includes(data.teamId)) throw new AppError('You can only create work for one of your own teams.', 403, 'TEAM_SCOPE_DENIED');
    if (!data.teamId && !data.ticketId && parentId) { const parent = await prisma.task.findFirst({ where: { id: parentId, ...taskTeamScope(ctx) }, select: { teamId: true } }); if (parent?.teamId) data.teamId = parent.teamId; }
    if (!data.teamId && !data.ticketId && ownTeamIds.length === 1) data.teamId = ownTeamIds[0];
    if (!data.teamId && !data.ticketId && ownTeamIds.length > 1) throw new AppError('Select your owning team for this task.', 400, 'TEAM_REQUIRED');
  }
  if (!data.teamId && !data.ticketId && !parentId) {
    if (ownTeamIds.length === 1) data.teamId = ownTeamIds[0];
    else if (ownTeamIds.length > 1) throw new AppError('Select an owning team for this task.', 400, 'TEAM_REQUIRED');
    else throw new AppError('An owning team is required for standalone tasks.', 400, 'TEAM_REQUIRED');
  }
  const accessIds = [...new Set([...(data.teamId ? [data.teamId] : []), ...teamIds])];
  if (accessIds.length) {
    const valid = await prisma.team.findMany({ where: { id: { in: accessIds }, organization: { type: 'INTERNAL' } }, select: { id: true } });
    if (valid.length !== accessIds.length) throw new AppError('One or more task teams are invalid.', 400, 'INVALID_TEAM');
  }
  if (parentId && !data.teamId) { const parent = await prisma.task.findFirst({ where: { id: parentId, ...taskTeamScope(ctx) }, select: { teamId: true } }); if (parent?.teamId) data.teamId = parent.teamId; }
  if (data.ticketId) {
    const ticket = await prisma.ticket.findFirst({ where: { id: data.ticketId, AND: [ticketScope(ctx)] }, include: { teamAccesses: true } });
    if (!ticket) throw new AppError('Linked ticket not found or not accessible.', 404);
    if (!ticket.teamAccesses.length) throw new AppError('Route this ticket to a team before creating linked work.', 409, 'TICKET_NOT_ROUTED');
    if (!data.teamId) data.teamId = ticket.teamId;
  }

  // Team first, then assignees: everyone assigned must belong to the task's team(s) (owner + shared + ticket/parent teams).
  {
    const inheritedTeams = [
      ...(data.ticketId ? (await prisma.ticketTeamAccess.findMany({ where: { ticketId: data.ticketId }, select: { teamId: true } })).map((x) => x.teamId) : []),
      ...(parentId ? (await prisma.taskTeamAccess.findMany({ where: { taskId: parentId }, select: { teamId: true } })).map((x) => x.teamId) : []),
    ];
    const allowedTeams = [...new Set([...accessIds, ...inheritedTeams])];
    if (ids.length && !allowedTeams.length) throw new AppError('Pick a team first, then choose assignees from that team.', 409, 'TASK_NOT_ROUTED');
    const members = await loadTeamMemberIds(allowedTeams);
    // A task sent to a team you are not in is left for that team to pick up, not forced onto you.
    if (ids.length === 1 && ids[0] === me && !ctx.can('task.assign') && assigneesOutsideTeams(ids, allowedTeams, members).length) ids = [];
    const outside = assigneesOutsideTeams(ids, allowedTeams, members);
    if (outside.length) throw new AppError('Assignees must be members of the task’s team.', 400, 'ASSIGNEE_NOT_IN_TEAM');
  }

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: { ...data, parentId: parentId || null, creatorId: ctx.currentUser.id, assigneeId: ids[0] ?? null, assignees: { create: asRows(ids) } },
    });
    const inherited = data.ticketId ? await tx.ticketTeamAccess.findMany({ where: { ticketId: data.ticketId }, select: { teamId: true } }) : [];
    const allAccess = [...new Set([...accessIds, ...inherited.map((x) => x.teamId), ...(parentId ? (await tx.taskTeamAccess.findMany({ where: { taskId: parentId }, select: { teamId: true } })).map((x) => x.teamId) : [])])];
    if (allAccess.length) await tx.taskTeamAccess.createMany({ data: allAccess.map((teamId) => ({ taskId: created.id, teamId, accessRole: teamId === data.teamId ? 'OWNER' : 'PARTICIPANT', addedById: ctx.currentUser.id })), skipDuplicates: true });
    // For cross-team work, keep the creator's team as the review authority without
    // treating it as a destination/assignee team. That team closes the task after review.
    const reviewerTeamIds = taskReviewerTeamIds(ownTeamIds, data.teamId);
    for (const teamId of reviewerTeamIds) {
      await tx.taskTeamAccess.upsert({
        where: { taskId_teamId: { taskId: created.id, teamId } },
        create: { taskId: created.id, teamId, accessRole: 'REVIEWER', addedById: ctx.currentUser.id },
        update: { accessRole: 'REVIEWER' },
      });
    }
    // Sync: new work on a ticket that was waiting for the client's final OK puts the ticket back to In progress.
    if (data.ticketId && !parentId) {
      const tk = await tx.ticket.findUnique({ where: { id: data.ticketId }, select: { id: true, status: true } });
      if (tk?.status === 'REVIEW_TEST') {
        const reopened = await tx.ticket.update({ where: { id: tk.id }, data: { status: 'OPEN', progress: 'IN_PROGRESS', closedAt: null } });
        await syncTaskFromTicket(tx, reopened, { changed: ['status', 'progress'], actor: ctx.currentUser });
        await recordTicketEvents(tx, tk.id, ctx.currentUser.id, [{ type: 'STATUS', fromValue: 'REVIEW_TEST:RESOLVED', toValue: 'OPEN:IN_PROGRESS', note: 'New task added', clientVisible: true }]);
      }
    }
    return created;
  });
  await logActivity({
    actorId: ctx.currentUser.id, organizationId: task.organizationId, entityType: 'task', entityId: task.id,
    action: 'created', summary: `Created task ${task.title}`,
  });
  for (const userId of ids) await notifyAssignment({ userId, actor: ctx.currentUser, title: task.title, kind: 'task', href: link(task) });
  if (task.ticketId) await recordTicketEvents(prisma, task.ticketId, ctx.currentUser.id, [{ type: 'TASK', toValue: task.id, toLabel: task.title, clientVisible: false }]);
  const foreign = [...new Set([task.teamId, ...teamIds].filter((id) => id && !ownTeamIds.includes(id)))];
  if (foreign.length && !ids.length) {
    const managers = await findTeamManagers(foreign);
    await notifyPeople({ userIds: managers.map((u) => u.id), actorId: me, type: 'ASSIGNMENT', title: `New task sent to your team: ${task.title}`, body: `${ctx.currentUser.name || ctx.currentUser.email} created it. Assign someone from your team.`, href: link(task) });
  }
  return task;
}

export async function patchTask(ctx, id, input) {
  const old = await prisma.task.findFirst({ where: { id, ...taskTeamScope(ctx) }, include: { assignees: true, teamAccesses: true } });
  if (!old || !ctx.isInternal || !canSeeOrg(ctx, old.organizationId)) throw new AppError('Task not found', 404);
  const { assigneeIds, assigneeId, teamIds, ...data } = input;
  const ids = resolveAssignees({ assigneeIds, assigneeId });
  if (ids && !ctx.can('task.assign')) throw new AppError("You don't have permission to change assignees (task.assign).", 403);
  if ((teamIds || data.teamId !== undefined) && !ctx.can('task.assign')) throw new AppError('Only authorized task assigners can change participating teams.', 403);
  if (data.teamId) { const validTeam = await prisma.team.findFirst({ where: { id: data.teamId, organization: { type: 'INTERNAL' } }, select: { id: true } }); if (!validTeam) throw new AppError('Invalid task team.', 400, 'INVALID_TEAM'); }
  if (teamIds) { const validTeams = teamIds.length ? await prisma.team.findMany({ where: { id: { in: teamIds }, organization: { type: 'INTERNAL' } }, select: { id: true } }) : []; if (validTeams.length !== new Set(teamIds).size) throw new AppError('One or more task teams are invalid.', 400, 'INVALID_TEAM'); }
  const actorTeamIds = [...new Set((ctx.memberships || []).flatMap((m) => (m.teamMemberships || []).map((tm) => tm.teamId)))];
  const reviewerTeamIds = (old.teamAccesses || []).filter((a) => a.accessRole === 'REVIEWER').map((a) => a.teamId);
  const workTeamIds = [...new Set([...(old.teamAccesses || []).filter((a) => a.accessRole !== 'REVIEWER').map((a) => a.teamId), old.teamId].filter(Boolean))];
  const assigneeIdsNow = [...new Set([old.assigneeId, ...old.assignees.map((a) => a.userId)].filter(Boolean))];
  const ticketRow = old.ticketId ? await prisma.ticket.findUnique({ where: { id: old.ticketId }, select: { status: true, visibility: true, requesterId: true, assigneeId: true, organizationId: true, key: true, title: true, organization: { select: { type: true } } } }) : null;
  const ticketIsClient = ticketRow?.organization?.type === 'CLIENT' && ticketRow?.visibility === 'CLIENT';
  const authority = reviewAuthorityOf({ autoCreated: old.autoCreated, parentId: old.parentId, ticketIsClient, reviewerTeamIds, creatorId: old.creatorId, assigneeIds: assigneeIdsNow });
  const actorCanReview = canApproveTask({ canUpdateAny: ctx.can('task.update_any'), actorTeamIds, reviewerTeamIds });
  const mayFinish = canFinishTask({ authority, actorId: ctx.currentUser.id, canUpdateAny: ctx.can('task.update_any'), actorTeamIds, reviewerTeamIds, workTeamIds, creatorId: old.creatorId, assigneeIds: assigneeIdsNow });
  const hasTeamReviewer = authority === 'TEAM';

  // WHO MAY DO WHAT. Details: creator, assignees, the reviewing team, admins (canEditTask).
  // STATUS: only the people the task was given to (plus admins). A subtask can also be ticked by its parent's assignee.
  // The only other person who may touch the status is the reviewer, and only to approve or send back what is in Review.
  const me = ctx.currentUser.id;
  const isAdmin = ctx.can('task.update_any');
  const isAssignee = assigneeIdsNow.includes(me);
  let parentMate = false;
  if (old.parentId) {
    const parent = await prisma.task.findUnique({ where: { id: old.parentId }, select: { assigneeId: true, assignees: { select: { userId: true } } } });
    parentMate = !!parent && [parent.assigneeId, ...parent.assignees.map((a) => a.userId)].includes(me);
  }
  const unassignedMate = assigneeIdsNow.length === 0 && workTeamIds.some((id) => actorTeamIds.includes(id)); // nobody owns it yet: a teammate can pick it up
  const asDoer = isAdmin || isAssignee || parentMate || unassignedMate;
  const statusMove = data.status !== undefined && data.status !== old.status;
  const reviewerMove = !isAssignee && mayFinish && ['PEER', 'TEAM'].includes(authority)
    && ((old.status === 'REVIEW' && ['DONE', 'IN_PROGRESS'].includes(data.status)) || (old.status === 'DONE' && data.status === 'IN_PROGRESS'));
  const canEdit = canEditTask(ctx, old);
  const onlyStatus = Object.keys(data).length === 1 && data.status !== undefined && !ids && !teamIds;
  if (!canEdit && !(onlyStatus && (reviewerMove || (unassignedMate && statusMove)))) throw new AppError('You can only edit tasks you created or are assigned to.', 403, 'TASK_EDIT_FORBIDDEN');
  if (statusMove && !asDoer && !reviewerMove) {
    throw new AppError(assigneeIdsNow.length ? 'Only the people this task is assigned to can change its status.' : 'You cannot change this task’s status.', 403, 'TASK_STATUS_ASSIGNEE_ONLY');
  }
  if (data.status === 'DONE' && authority === 'TICKET') {
    throw new AppError('This task mirrors a ticket. It becomes Done only through the ticket approval action.', 403, 'TICKET_APPROVAL_REQUIRED');
  }
  if (data.status === 'DONE' && old.status !== 'DONE' && !mayFinish) {
    throw new AppError(REVIEW_HINT[authority] || 'You cannot mark this task Done.', 403, 'TASK_REVIEW_REQUIRED');
  }
  if (data.status === 'DONE' && authority !== 'NONE' && old.status !== 'REVIEW' && old.status !== 'DONE') {
    throw new AppError('A task must be submitted to Review before it can be marked Done.', 409, 'TASK_NOT_IN_REVIEW');
  }
  if (old.status === 'DONE' && data.status !== undefined && data.status !== 'DONE' && !(authority === 'TICKET' ? actorCanReview : mayFinish)) {
    throw new AppError(authority === 'CLIENT' ? 'This task was approved by the client. Ask a platform admin to reopen it.' : 'Only the reviewer can reopen a completed task.', 403, 'TASK_REOPEN_FORBIDDEN');
  }
  if (old.autoCreated && data.status !== undefined && data.status !== old.status) {
    const mirrorTicket = await prisma.ticket.findUnique({ where: { id: old.ticketId }, select: { status: true } });
    if (mirrorTicket?.status === 'CLOSED') {
      throw new AppError('This ticket is already approved. Its mirror task cannot be reopened directly.', 409, 'TICKET_ALREADY_APPROVED');
    }
    if (mirrorTicket?.status === 'REVIEW_TEST' && data.status !== 'REVIEW') {
      throw new AppError('The ticket is waiting for client review. Only the client can approve it or send it back.', 409, 'CLIENT_REVIEW_LOCKED');
    }
    if (mirrorTicket?.status === 'REVIEW_HELP' && data.status !== 'BLOCKED') {
      throw new AppError('The ticket is waiting for client information. The client must respond before work resumes.', 409, 'CLIENT_REPLY_REQUIRED');
    }
  }
  if (['REVIEW', 'DONE'].includes(data.status)) await assertTaskSubtasksDone(prisma, old.id);
  if (data.status !== undefined && data.status !== old.status) data.completedAt = data.status === 'DONE' ? new Date() : null;
  if (data.parentId !== undefined && data.parentId !== old.parentId) {
    if (data.parentId === old.id) throw new AppError('A task cannot be its own parent.', 400, 'TASK_CYCLE');
    if (data.parentId) {
      const parent = await prisma.task.findFirst({ where: { id: data.parentId, organizationId: old.organizationId, ...taskTeamScope(ctx) }, select: { id: true, parentId: true } });
      if (!parent) throw new AppError('Parent task not found or not accessible.', 404);
      let cursor = parent; const seen = new Set();
      while (cursor?.parentId && !seen.has(cursor.id)) {
        if (cursor.parentId === old.id) throw new AppError('This parent change would create a task cycle.', 400, 'TASK_CYCLE');
        seen.add(cursor.id);
        cursor = await prisma.task.findUnique({ where: { id: cursor.parentId }, select: { id: true, parentId: true } });
      }
    }
  }
  // Team first, then assignees. Explicit assignees must fit the (new) teams; when the teams change, people who no longer fit are removed.
  let nextIds = ids;
  {
    const ownerNext = data.teamId !== undefined ? data.teamId : old.teamId;
    const sharedNext = teamIds !== undefined ? teamIds : (old.teamAccesses || []).filter((a) => a.teamId !== old.teamId && a.accessRole !== 'REVIEWER').map((a) => a.teamId);
    const teamsNext = [...new Set([...(ownerNext ? [ownerNext] : []), ...sharedNext])];
    const teamsChanged = teamIds !== undefined || data.teamId !== undefined;
    if (nextIds || teamsChanged) {
      const current = nextIds ?? old.assignees.map((a) => a.userId);
      if (current.length) {
        if (!teamsNext.length) throw new AppError('Pick a team first, then choose assignees from that team.', 409, 'TASK_NOT_ROUTED');
        const members = await loadTeamMemberIds(teamsNext);
        const outside = assigneesOutsideTeams(current, teamsNext, members);
        if (outside.length && nextIds) throw new AppError('Assignees must be members of the task’s team.', 400, 'ASSIGNEE_NOT_IN_TEAM');
        if (outside.length) nextIds = current.filter((id) => !outside.includes(id));
      }
    }
  }
  if (nextIds) {
    await assertAssignees(nextIds);
    data.assigneeId = nextIds[0] ?? null;
    data.assignees = { deleteMany: {}, create: asRows(nextIds) };
  }

  const { task, syncedTicket } = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: old.id }, data });
    if (teamIds || data.teamId !== undefined) {
      const ownerId = data.teamId !== undefined ? data.teamId : old.teamId;
      const all = [...new Set([...(ownerId ? [ownerId] : []), ...(teamIds || [])])];
      const oldReviewerIds = (old.teamAccesses || []).filter((a) => a.accessRole === 'REVIEWER').map((a) => a.teamId);
      const creatorMemberships = old.creatorId ? await tx.membership.findMany({ where: { userId: old.creatorId, isActive: true, organization: { type: 'INTERNAL' } }, include: { teamMemberships: { select: { teamId: true } } } }) : [];
      const creatorTeamIds = creatorMemberships.flatMap((m) => m.teamMemberships.map((tm) => tm.teamId));
      const reviewerIds = [...new Set([...oldReviewerIds, ...taskReviewerTeamIds(creatorTeamIds, ownerId)])].filter((id) => id !== ownerId);
      await tx.taskTeamAccess.deleteMany({ where: { taskId: old.id, accessRole: { not: 'REVIEWER' } } });
      await tx.taskTeamAccess.deleteMany({ where: { taskId: old.id, accessRole: 'REVIEWER', teamId: { in: all } } });
      const normalAccess = all.filter((teamId) => !reviewerIds.includes(teamId));
      if (normalAccess.length) await tx.taskTeamAccess.createMany({ data: normalAccess.map((teamId) => ({ taskId: old.id, teamId, accessRole: teamId === ownerId ? 'OWNER' : 'PARTICIPANT', addedById: ctx.currentUser.id })) });
      for (const teamId of reviewerIds) {
        await tx.taskTeamAccess.upsert({
          where: { taskId_teamId: { taskId: old.id, teamId } },
          create: { taskId: old.id, teamId, accessRole: 'REVIEWER', addedById: ctx.currentUser.id },
          update: { accessRole: 'REVIEWER' },
        });
      }
    }
    const ticketSync = data.status && data.status !== old.status ? await syncTicketFromTask(tx, updated, { actor: ctx.currentUser }) : null;
    return { task: updated, syncedTicket: ticketSync };
  });
  await logActivity({
    actorId: ctx.currentUser.id, organizationId: task.organizationId, entityType: 'task', entityId: task.id,
    action: 'updated', summary: `Updated task ${task.title}`,
  });
  if (nextIds) {
    const before = new Set([old.assigneeId, ...old.assignees.map((a) => a.userId)].filter(Boolean));
    for (const userId of nextIds.filter((u) => !before.has(u))) await notifyAssignment({ userId, actor: ctx.currentUser, title: task.title, kind: 'task', href: link(task) });
  }
  if (data.status === 'REVIEW' && old.status !== 'REVIEW' && authority === 'CLIENT' && ticketRow) {
    await recordClientReviewRequest(prisma, { task, ticket: { id: old.ticketId, ...ticketRow }, actor: ctx.currentUser });
  }
  if (data.status === 'REVIEW' && old.status !== 'REVIEW' && authority === 'PEER') {
    const mates = await findTeamManagers(workTeamIds);
    await notifyPeople({ userIds: mates.filter((u) => !assigneeIdsNow.includes(u.id)).map((u) => u.id), actorId: ctx.currentUser.id, type: 'STATUS_CHANGE', title: `Task ready for review: ${task.title}`, body: `${ctx.currentUser.name || ctx.currentUser.email} submitted it for a teammate to check.`, href: link(task), email: false });
  }
  if (data.status === 'REVIEW' && hasTeamReviewer) {
    const reviewers = await findTeamManagers(reviewerTeamIds);
    await notifyPeople({ userIds: reviewers.map((u) => u.id), actorId: ctx.currentUser.id, type: 'STATUS_CHANGE', title: `Task ready for your review: ${task.title}`, body: `${ctx.currentUser.name || ctx.currentUser.email} submitted this cross-team task for review.`, href: link(task) });
  }
  if (syncedTicket?.status === 'REVIEW_TEST' && syncedTicket.requesterId) {
    await notifyPeople({ userIds: [syncedTicket.requesterId], actorId: ctx.currentUser.id, type: 'STATUS_CHANGE', title: `${syncedTicket.key} is ready for your review`, body: `All linked work for "${syncedTicket.title}" is complete. Please approve it or send it back with feedback.`, href: `/?ticket=${syncedTicket.id}` });
  }
  return task;
}

// ---- Task comments: internal team talk, visible to everyone who can open the task (never to clients) ----
const authorSelect = { author: { select: userSelect } };

async function loadTask(ctx, id) {
  if (!ctx.isInternal) throw new AppError('Task not found', 404);
  const t = await prisma.task.findFirst({ where: { id, ...taskTeamScope(ctx) }, include: { assignees: true } });
  if (!t || !canSeeOrg(ctx, t.organizationId)) throw new AppError('Task not found', 404);
  return t;
}

export async function listTaskComments(ctx, taskId) {
  const t = await loadTask(ctx, taskId);
  return prisma.comment.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'asc' }, include: authorSelect, take: 500 });
}

export async function addTaskComment(ctx, taskId, input) {
  const t = await loadTask(ctx, taskId);
  const { body } = input;
  const c = await prisma.comment.create({ data: { body, visibility: 'INTERNAL', taskId: t.id, authorId: ctx.currentUser.id }, include: authorSelect });
  await logActivity({ actorId: ctx.currentUser.id, organizationId: t.organizationId, entityType: 'task', entityId: t.id, action: 'commented', summary: `Comment added to task ${t.title}` });
  await notifyPeople({ userIds: taskCommentRecipients(t, ctx.currentUser.id), actorId: ctx.currentUser.id, type: 'COMMENT', title: `New comment on task: ${t.title}`, body: `${ctx.currentUser.name || ctx.currentUser.email}: ${body.slice(0, 200)}`, href: link(t), email: false });
  return c;
}

export async function deleteTaskComment(ctx, taskId, commentId) {
  const t = await loadTask(ctx, taskId);
  const c = await prisma.comment.findFirst({ where: { id: commentId, taskId: t.id } });
  if (!c) throw new AppError('Comment not found', 404);
  if (c.authorId !== ctx.currentUser.id && !ctx.can('task.update_any')) throw new AppError('You can only delete your own comments.', 403);
  await prisma.comment.delete({ where: { id: c.id } });
}

export async function listTaskAttachments(ctx, taskId) {
  const t = await loadTask(ctx, taskId);
  return prisma.attachment.findMany({ where: { taskId: t.id, inline: false }, orderBy: { createdAt: 'desc' }, select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadedById: true } });
}
