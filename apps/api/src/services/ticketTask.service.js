import { logActivity } from './activity.js';
import { AppError } from '../errors/AppError.js';
import { recordTicketEvents } from './ticketHistory.service.js';
import { notifyReviewReady } from './ticketReview.js';
import { TICKET_TO_TASK, TASK_TO_TICKET, taskTitleFor } from './ticketTaskMaps.js';

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
        priority: ticket.priority, dueDate: ticket.dueDate ?? null, status: TICKET_TO_TASK[ticket.status] || 'TODO',
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
  if (has('status') && TICKET_TO_TASK[ticket.status]) data.status = TICKET_TO_TASK[ticket.status];

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


export async function assertTaskSubtasksDone(db, taskId) {
  let frontier = await db.task.findMany({ where: { parentId: taskId }, select: { id: true, title: true, status: true } });
  const seen = new Set();
  while (frontier.length) {
    const current = frontier.filter((t) => !seen.has(t.id));
    if (!current.length) break;
    for (const t of current) {
      seen.add(t.id);
      if (t.status !== 'DONE') {
        throw new AppError(`Cannot complete this task until subtask "${t.title}" is DONE.`, 409, 'SUBTASKS_INCOMPLETE');
      }
    }
    frontier = await db.task.findMany({ where: { parentId: { in: current.map((t) => t.id) } }, select: { id: true, title: true, status: true } });
  }
}

/** When the auto task changes status, move the ticket along with it. */
export async function syncTicketFromTask(db, task, { actor } = {}) {
  if (!task.autoCreated || !task.ticketId) return null;
  const ticket = await db.ticket.findUnique({ where: { id: task.ticketId } });
  if (task.status === 'DONE') await assertTaskSubtasksDone(db, task.id);
  let next = TASK_TO_TICKET[task.status];
  if (!ticket || !next) return null;
  // A completed auto-task for a client-raised ticket is a handoff, not client approval.
  // Keep employee-originated tickets on the existing internal workflow.
  if (task.status === 'DONE' && ticket.visibility === 'CLIENT') {
    const requesterIsInternal = await db.membership.findFirst({
      where: { userId: ticket.requesterId, isActive: true, organization: { type: 'INTERNAL', isActive: true } },
      select: { id: true },
    });
    if (!requesterIsInternal) next = 'CLIENT_REVIEW';
  }
  if (next === ticket.status || (next !== 'CLIENT_REVIEW' && TICKET_TO_TASK[ticket.status] === task.status)) return null; // already consistent unless a client-review handoff is required
  const updated = await db.ticket.update({ where: { id: ticket.id }, data: { status: next } });
  await logActivity({
    actorId: actor?.id, organizationId: updated.organizationId, entityType: 'ticket', entityId: updated.id, action: 'updated',
    summary: `Ticket ${updated.key} moved to ${next.replaceAll('_', ' ').toLowerCase()} (task progress)`,
    metadata: { visibility: updated.visibility, requesterId: updated.requesterId },
  });
  await recordTicketEvents(null, updated.id, actor?.id, [{ type: 'STATUS', fromValue: ticket.status, toValue: next, note: 'Moved by task progress', clientVisible: true }]);
  if (next === 'REVIEW' || next === 'CLIENT_REVIEW') await notifyReviewReady(updated, actor);
  return updated;
}
