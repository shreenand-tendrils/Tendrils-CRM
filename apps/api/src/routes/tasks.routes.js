import { Router } from 'express';
import { prisma } from '../db.js';
import { orgScope, requirePermission, canSeeOrg, taskTeamScope, ticketScope } from '../middleware/index.js';
import { canEditTask } from '../rbac/policies.js';
import {
  logActivity, notifyAssignment, notifyPeople, findTeamManagers, resolveAssignees, assertAssignees, assertProjectInOrg, assertTicketInOrg, syncTicketFromTask, assertTaskSubtasksDone, loadTeamMemberIds, recordTicketEvents,
} from '../services/index.js';
import { assigneesOutsideTeams } from '../services/ticketRouting.js';
import { taskCommentRecipients } from '../services/taskComments.js';
import { employeeIds, finishBlocked, NEEDS_MANAGER_REVIEW_MESSAGE } from '../services/ticketReview.js';
import { commentCreate } from '../validators/schemas.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { taskCreate, taskUpdate } from '../validators/schemas.js';

const router = Router();
const userSelect = { id: true, name: true, email: true, image: true };
const include = {
  organization: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  ticket: { select: { id: true, key: true, title: true } },
  parent: { select: { id: true, title: true, status: true } },
  team: { select: { id: true, name: true } },
  teamAccesses: { include: { team: { select: { id: true, name: true } } } },
  assignee: { select: userSelect },
  assignees: { include: { user: { select: userSelect } } },
  creator: { select: userSelect },
  _count: { select: { comments: true, attachments: true } },
};
const asRows = (ids) => ids.map((userId) => ({ userId }));
const link = (t) => `/?task=${t.id}`;

// Tasks are internal work items: clients get an empty list (so the shared workspace
// load still succeeds) and cannot create or edit them.
router.get('/tasks', async (req, res) => {
  if (!req.isInternal) return res.json([]);
  const mine = req.query.mine === 'true' ? { OR: [{ assigneeId: req.currentUser.id }, { assignees: { some: { userId: req.currentUser.id } } }] } : {};
  res.json(await prisma.task.findMany({ where: { AND: [orgScope(req), taskTeamScope(req), mine] }, orderBy: [{ position: 'asc' }, { updatedAt: 'desc' }], take: 300, include }));
});

router.post('/tasks', requirePermission('task.create'), async (req, res) => {
  const { assigneeIds, assigneeId, teamIds = [], parentId, ...data } = parseBody(taskCreate, req.body);
  let ids = resolveAssignees({ assigneeIds, assigneeId }) ?? [];
  const me = req.currentUser.id;
  const cross = req.can('task.assign') || req.can('work.cross_team'); // may send work to other teams
  if (!cross && ids.some((id) => id !== me)) throw new AppError("You don't have permission to assign tasks to others (task.assign).", 403);
  if (!req.can('task.assign') && !ids.length) ids = [me]; // employees' own tasks default to themselves (dropped below if the task goes to another team)
  if (!canSeeOrg(req, data.organizationId)) throw new AppError('Organization access denied', 403);
  await assertProjectInOrg(data.projectId, data.organizationId);
  await assertTicketInOrg(data.ticketId, data.organizationId);
  await assertAssignees(ids);
  if (parentId) {
    const parent = await prisma.task.findFirst({ where: { id: parentId, organizationId: data.organizationId, ...taskTeamScope(req) }, select: { id: true } });
    if (!parent) throw new AppError('Parent task not found or not accessible.', 404);
  }
  if (teamIds.length && !cross) throw new AppError('Only authorized task assigners can distribute work across teams.', 403);
  const ownTeamIds = [...new Set(req.memberships.flatMap((m) => (m.teamMemberships || []).map((tm) => tm.teamId)))];
  if (!req.can('task.assign')) {
    if (!cross && data.teamId && !ownTeamIds.includes(data.teamId)) throw new AppError('You can only create work for one of your own teams.', 403, 'TEAM_SCOPE_DENIED');
    if (!data.teamId && !data.ticketId && parentId) { const parent = await prisma.task.findFirst({ where: { id: parentId, ...taskTeamScope(req) }, select: { teamId: true } }); if (parent?.teamId) data.teamId = parent.teamId; }
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
  if (parentId && !data.teamId) { const parent = await prisma.task.findFirst({ where: { id: parentId, ...taskTeamScope(req) }, select: { teamId: true } }); if (parent?.teamId) data.teamId = parent.teamId; }
  if (data.ticketId) {
    const ticket = await prisma.ticket.findFirst({ where: { id: data.ticketId, AND: [ticketScope(req)] }, include: { teamAccesses: true } });
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
    if (ids.length === 1 && ids[0] === me && !req.can('task.assign') && assigneesOutsideTeams(ids, allowedTeams, members).length) ids = [];
    const outside = assigneesOutsideTeams(ids, allowedTeams, members);
    if (outside.length) throw new AppError('Assignees must be members of the task’s team.', 400, 'ASSIGNEE_NOT_IN_TEAM');
  }

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: { ...data, parentId: parentId || null, creatorId: req.currentUser.id, assigneeId: ids[0] ?? null, assignees: { create: asRows(ids) } },
    });
    const inherited = data.ticketId ? await tx.ticketTeamAccess.findMany({ where: { ticketId: data.ticketId }, select: { teamId: true } }) : [];
    const allAccess = [...new Set([...accessIds, ...inherited.map((x) => x.teamId), ...(parentId ? (await tx.taskTeamAccess.findMany({ where: { taskId: parentId }, select: { teamId: true } })).map((x) => x.teamId) : [])])];
    if (allAccess.length) await tx.taskTeamAccess.createMany({ data: allAccess.map((teamId) => ({ taskId: created.id, teamId, accessRole: teamId === data.teamId ? 'OWNER' : 'PARTICIPANT', addedById: req.currentUser.id })), skipDuplicates: true });
    return created;
  });
  await logActivity({
    actorId: req.currentUser.id, organizationId: task.organizationId, entityType: 'task', entityId: task.id,
    action: 'created', summary: `Created task ${task.title}`,
  });
  for (const userId of ids) await notifyAssignment({ userId, actor: req.currentUser, title: task.title, kind: 'task', href: link(task) });
  if (task.ticketId) await recordTicketEvents(prisma, task.ticketId, req.currentUser.id, [{ type: 'TASK', toValue: task.id, toLabel: task.title, clientVisible: false }]);
  const foreign = [...new Set([task.teamId, ...teamIds].filter((id) => id && !ownTeamIds.includes(id)))];
  if (foreign.length && !ids.length) {
    const managers = await findTeamManagers(foreign);
    await notifyPeople({ userIds: managers.map((u) => u.id), actorId: me, type: 'ASSIGNMENT', title: `New task sent to your team: ${task.title}`, body: `${req.currentUser.name || req.currentUser.email} created it. Assign someone from your team.`, href: link(task) });
  }
  res.status(201).json(task);
});

router.patch('/tasks/:id', async (req, res) => {
  const old = await prisma.task.findFirst({ where: { id: req.params.id, ...taskTeamScope(req) }, include: { assignees: true, teamAccesses: true } });
  if (!old || !req.isInternal || !canSeeOrg(req, old.organizationId)) throw new AppError('Task not found', 404);
  if (!canEditTask(req, old)) throw new AppError("You can only edit tasks you created or are assigned to.", 403);
  const { assigneeIds, assigneeId, teamIds, ...data } = parseBody(taskUpdate, req.body);
  const ids = resolveAssignees({ assigneeIds, assigneeId });
  if (ids && !req.can('task.assign')) throw new AppError("You don't have permission to change assignees (task.assign).", 403);
  if ((teamIds || data.teamId !== undefined) && !req.can('task.assign')) throw new AppError('Only authorized task assigners can change participating teams.', 403);
  if (data.teamId) { const validTeam = await prisma.team.findFirst({ where: { id: data.teamId, organization: { type: 'INTERNAL' } }, select: { id: true } }); if (!validTeam) throw new AppError('Invalid task team.', 400, 'INVALID_TEAM'); }
  if (teamIds) { const validTeams = teamIds.length ? await prisma.team.findMany({ where: { id: { in: teamIds }, organization: { type: 'INTERNAL' } }, select: { id: true } }) : []; if (validTeams.length !== new Set(teamIds).size) throw new AppError('One or more task teams are invalid.', 400, 'INVALID_TEAM'); }
  if (data.status === 'DONE' && old.autoCreated && old.ticketId && !req.can('ticket.triage')) {
    const tk = await prisma.ticket.findUnique({ where: { id: old.ticketId }, select: { requesterId: true } });
    const emp = await employeeIds(prisma, [tk?.requesterId]);
    if (finishBlocked({ internal: true, canTriage: false, status: 'RESOLVED', requesterIsEmployee: emp.has(tk?.requesterId) })) throw new AppError('This task mirrors a ticket that needs a manager’s review. Move it to Review and your manager will resolve or close it.', 403, 'NEEDS_MANAGER_REVIEW');
  }
  if (data.status === 'DONE') await assertTaskSubtasksDone(prisma, old.id);
  if (data.parentId !== undefined && data.parentId !== old.parentId) {
    if (data.parentId === old.id) throw new AppError('A task cannot be its own parent.', 400, 'TASK_CYCLE');
    if (data.parentId) {
      const parent = await prisma.task.findFirst({ where: { id: data.parentId, organizationId: old.organizationId, ...taskTeamScope(req) }, select: { id: true, parentId: true } });
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
    const sharedNext = teamIds !== undefined ? teamIds : (old.teamAccesses || []).filter((a) => a.teamId !== old.teamId).map((a) => a.teamId);
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

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: old.id }, data });
    if (teamIds || data.teamId !== undefined) {
      const all = [...new Set([...(data.teamId !== undefined ? (data.teamId ? [data.teamId] : []) : (old.teamId ? [old.teamId] : [])), ...(teamIds || [])])];
      await tx.taskTeamAccess.deleteMany({ where: { taskId: old.id } });
      if (all.length) await tx.taskTeamAccess.createMany({ data: all.map((teamId) => ({ taskId: old.id, teamId, accessRole: teamId === (data.teamId ?? old.teamId) ? 'OWNER' : 'PARTICIPANT', addedById: req.currentUser.id })) });
    }
    if (data.status && data.status !== old.status) await syncTicketFromTask(tx, updated, { actor: req.currentUser });
    return updated;
  });
  await logActivity({
    actorId: req.currentUser.id, organizationId: task.organizationId, entityType: 'task', entityId: task.id,
    action: 'updated', summary: `Updated task ${task.title}`,
  });
  if (nextIds) {
    const before = new Set([old.assigneeId, ...old.assignees.map((a) => a.userId)].filter(Boolean));
    for (const userId of nextIds.filter((u) => !before.has(u))) await notifyAssignment({ userId, actor: req.currentUser, title: task.title, kind: 'task', href: link(task) });
  }
  res.json(task);
});
// ---- Task comments: internal team talk, visible to everyone who can open the task (never to clients) ----
const authorSelect = { author: { select: userSelect } };
async function loadTask(req) {
  if (!req.isInternal) throw new AppError('Task not found', 404);
  const t = await prisma.task.findFirst({ where: { id: req.params.id, ...taskTeamScope(req) }, include: { assignees: true } });
  if (!t || !canSeeOrg(req, t.organizationId)) throw new AppError('Task not found', 404);
  return t;
}

router.get('/tasks/:id/comments', async (req, res) => {
  const t = await loadTask(req);
  res.json(await prisma.comment.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'asc' }, include: authorSelect, take: 500 }));
});

router.post('/tasks/:id/comments', requirePermission('ticket.comment_internal'), async (req, res) => {
  const t = await loadTask(req);
  const { body } = parseBody(commentCreate, req.body);
  const c = await prisma.comment.create({ data: { body, visibility: 'INTERNAL', taskId: t.id, authorId: req.currentUser.id }, include: authorSelect });
  await logActivity({ actorId: req.currentUser.id, organizationId: t.organizationId, entityType: 'task', entityId: t.id, action: 'commented', summary: `Comment added to task ${t.title}` });
  await notifyPeople({ userIds: taskCommentRecipients(t, req.currentUser.id), actorId: req.currentUser.id, type: 'COMMENT', title: `New comment on task: ${t.title}`, body: `${req.currentUser.name || req.currentUser.email}: ${body.slice(0, 200)}`, href: link(t), email: false });
  res.status(201).json(c);
});

router.delete('/tasks/:id/comments/:commentId', async (req, res) => {
  const t = await loadTask(req);
  const c = await prisma.comment.findFirst({ where: { id: req.params.commentId, taskId: t.id } });
  if (!c) throw new AppError('Comment not found', 404);
  if (c.authorId !== req.currentUser.id && !req.can('task.update_any')) throw new AppError('You can only delete your own comments.', 403);
  await prisma.comment.delete({ where: { id: c.id } });
  res.json({ ok: true });
});

router.get('/tasks/:id/attachments', async (req, res) => {
  const t = await loadTask(req);
  res.json(await prisma.attachment.findMany({ where: { taskId: t.id }, orderBy: { createdAt: 'desc' }, select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadedById: true } }));
});

export default router;
