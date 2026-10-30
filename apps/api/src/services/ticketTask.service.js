import { logActivity } from './activity.js';
import { AppError } from '../errors/AppError.js';
import { recordTicketEvents } from './ticketHistory.service.js';
import { statusKey, ticketToTaskStatus, TASK_TO_TICKET, taskTitleFor, shouldSubmitClientTicketForReview } from './ticketTaskMaps.js';
import { incompleteWorkTasks } from './review.js';
export { incompleteWorkTasks } from './review.js';

// Tickets and their auto-created task stay in step:
//  * a ticket with an assignee always has exactly one auto task (Task.autoCreated) for that assignee
//  * ticket status  -> task status, and task status -> ticket status (guarded so they never ping-pong)
/**
 * Create or update the ticket's auto task. `db` is prisma or a transaction client.
 * `changed` = names of ticket fields touched in this request (use 'ALL' on create).
 */
export async function syncTaskFromTicket(db, ticket, { prevAssigneeId = null, changed = ['ALL'], actor } = {}) {
  const has = (k) => changed.includes('ALL') || changed.includes(k);
  const task = await db.task.findFirst({ where: { ticketId: ticket.id, autoCreated: true }, include: { assignees: true } });

  if (!task) {
    if (!ticket.assigneeId) return null;
    const created = await db.task.create({
      data: {
        title: taskTitleFor(ticket), description: ticket.description ?? null, organizationId: ticket.organizationId,
        projectId: ticket.projectId ?? null, ticketId: ticket.id, teamId: ticket.teamId ?? null, autoCreated: true, creatorId: actor?.id ?? ticket.assigneeId,
        assigneeId: ticket.assigneeId, assignees: { create: [{ userId: ticket.assigneeId }] },
        priority: ticket.priority, dueDate: ticket.dueDate ?? null, status: ticketToTaskStatus(ticket.status, ticket.progress),
      },
    });
    const teamLinks = await db.ticketTeamAccess.findMany({ where: { ticketId: ticket.id }, select: { teamId: true, accessRole: true } });
    if (teamLinks.length) await db.taskTeamAccess.createMany({ data: teamLinks.map((x) => ({ taskId: created.id, teamId: x.teamId, accessRole: x.accessRole, addedById: actor?.id ?? null })), skipDuplicates: true });
    return created;
  }

  const data = {};
  if (has('title')) data.title = taskTitleFor(ticket);
  if (has('description')) data.description = ticket.description ?? null;
  if (has('priority')) data.priority = ticket.priority;
  if (has('dueDate')) data.dueDate = ticket.dueDate ?? null;
  if (has('projectId')) data.projectId = ticket.projectId ?? null;
  if (has('teamId') || has('teamIds')) data.teamId = ticket.teamId ?? null;
  if (has('status') || has('progress')) {
    data.status = ticketToTaskStatus(ticket.status, ticket.progress);
    if (data.status !== task.status) data.completedAt = data.status === 'DONE' ? new Date() : null;
  }

  if (has('assigneeId')) {
    let ids = task.assignees.map((a) => a.userId).filter((id) => id !== prevAssigneeId); // drop the previous owner, keep helpers
    if (ticket.assigneeId && !ids.includes(ticket.assigneeId)) ids = [ticket.assigneeId, ...ids];
    data.assigneeId = ids[0] ?? null;
    data.assignees = { deleteMany: {}, create: ids.map((userId) => ({ userId })) };
  }
  const updated = Object.keys(data).length ? await db.task.update({ where: { id: task.id }, data }) : task;
  if (has('teamId') || has('teamIds')) {
    const teamLinks = await db.ticketTeamAccess.findMany({ where: { ticketId: ticket.id }, select: { teamId: true, accessRole: true } });
    await db.taskTeamAccess.deleteMany({ where: { taskId: task.id } });
    if (teamLinks.length) await db.taskTeamAccess.createMany({ data: teamLinks.map((x) => ({ taskId: task.id, teamId: x.teamId, accessRole: x.accessRole, addedById: actor?.id ?? null })), skipDuplicates: true });
  }
  return updated;
}


export async function collectTicketTasks(db, ticketId) {
  let frontier = await db.task.findMany({ where: { ticketId }, select: { id: true, parentId: true, title: true, status: true, autoCreated: true } });
  const seen = new Map();
  while (frontier.length) {
    const current = frontier.filter((task) => !seen.has(task.id));
    if (!current.length) break;
    for (const task of current) seen.set(task.id, task);
    frontier = await db.task.findMany({ where: { parentId: { in: current.map((task) => task.id) } }, select: { id: true, parentId: true, title: true, status: true, autoCreated: true } });
  }
  return [...seen.values()];
}

export async function assertTicketWorkComplete(db, ticketId) {
  const incomplete = incompleteWorkTasks(await collectTicketTasks(db, ticketId));
  if (incomplete.length) {
    // Keep internal task names out of API errors because clients can also trigger this guard.
    throw new AppError('Cannot submit this ticket for review or close it until all linked tasks and subtasks are DONE.', 409, 'TICKET_WORK_INCOMPLETE');
  }
}

export async function assertTaskSubtasksDone(db, taskId) {
  let frontier = await db.task.findMany({ where: { parentId: taskId }, select: { id: true, title: true, status: true } });
  const seen = new Set();
  while (frontier.length) {
    const current = frontier.filter((task) => !seen.has(task.id));
    if (!current.length) break;
    for (const task of current) {
      seen.add(task.id);
      if (task.status !== 'DONE') {
        throw new AppError(`Cannot complete this task until subtask "${task.title}" is DONE.`, 409, 'SUBTASKS_INCOMPLETE');
      }
    }
    frontier = await db.task.findMany({ where: { parentId: { in: current.map((task) => task.id) } }, select: { id: true, title: true, status: true } });
  }
}

/** Keep ticket state in sync with its mirror task and with completion of real linked work. */
export async function syncTicketFromTask(db, task, { actor } = {}) {
  if (!task.ticketId) return null;

  // A ticket's auto-created task is a mirror. Its status drives the ticket, except DONE,
  // which can only arrive through the ticket's authorized approval action.
  if (task.autoCreated) {
    const ticket = await db.ticket.findUnique({ where: { id: task.ticketId } });
    if (!ticket) return null;
    if (task.status === 'DONE') await assertTaskSubtasksDone(db, task.id);
    const next = TASK_TO_TICKET[task.status];
    if (!next || ticketToTaskStatus(ticket.status, ticket.progress) === task.status) return null;
    if (next.status === 'REVIEW_TEST' || next.status === 'CLOSED') await assertTicketWorkComplete(db, ticket.id);
    const updated = await db.ticket.update({ where: { id: ticket.id }, data: { status: next.status, progress: next.progress, closedAt: next.status === 'CLOSED' ? new Date() : null } });
    await logActivity({
      actorId: actor?.id, organizationId: updated.organizationId, entityType: 'ticket', entityId: updated.id, action: 'updated',
      summary: `Ticket ${updated.key} moved to ${next.status.replaceAll('_', ' ').toLowerCase()} (task progress)`,
      metadata: { visibility: updated.visibility, requesterId: updated.requesterId },
    });
    await recordTicketEvents(null, updated.id, actor?.id, [{ type: 'STATUS', fromValue: statusKey(ticket.status, ticket.progress), toValue: statusKey(next.status, next.progress), note: 'Moved by task progress', clientVisible: true }]);
    return updated;
  }

  // Real linked work completing is the trigger for a CLIENT ticket's review hand-off.
  // Do not fail a task update just because other linked tasks are still in progress.
  if (task.status !== 'DONE') return null;
  const ticket = await db.ticket.findUnique({ where: { id: task.ticketId }, include: { organization: { select: { type: true } } } });
  if (!ticket) return null;
  const incomplete = incompleteWorkTasks(await collectTicketTasks(db, ticket.id));
  if (!shouldSubmitClientTicketForReview({ taskStatus: task.status, ticketStatus: ticket.status, organizationType: ticket.organization?.type, visibility: ticket.visibility, incompleteWorkCount: incomplete.length })) return null;

  const updated = await db.ticket.update({ where: { id: ticket.id }, data: { status: 'REVIEW_TEST', progress: 'RESOLVED', closedAt: null } });
  // The mirror task must reflect the ticket's client-review state, not remain Done/In progress.
  await syncTaskFromTicket(db, updated, { changed: ['status', 'progress'], actor });
  await logActivity({
    actorId: actor?.id, organizationId: updated.organizationId, entityType: 'ticket', entityId: updated.id, action: 'updated',
    summary: `Ticket ${updated.key} submitted for client review after linked work completed`,
    metadata: { visibility: updated.visibility, requesterId: updated.requesterId },
  });
  await recordTicketEvents(null, updated.id, actor?.id, [{ type: 'STATUS', fromValue: statusKey(ticket.status, ticket.progress), toValue: statusKey('REVIEW_TEST', 'RESOLVED'), note: 'All linked work completed; submitted for client review', clientVisible: true }]);
  return updated;
}
