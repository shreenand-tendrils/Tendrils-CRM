import { logActivity } from './activity.js';
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
    return db.task.create({
      data: {
        title: taskTitleFor(ticket), description: ticket.description ?? null, organizationId: ticket.organizationId,
        projectId: ticket.projectId ?? null, ticketId: ticket.id, autoCreated: true, creatorId: actor?.id ?? ticket.assigneeId,
        assigneeId: ticket.assigneeId, assignees: { create: [{ userId: ticket.assigneeId }] },
        priority: ticket.priority, dueDate: ticket.dueDate ?? null, status: TICKET_TO_TASK[ticket.status] || 'TODO',
      },
    });
  }

  const data = {};
  if (has('title')) data.title = taskTitleFor(ticket);
  if (has('description')) data.description = ticket.description ?? null;
  if (has('priority')) data.priority = ticket.priority;
  if (has('dueDate')) data.dueDate = ticket.dueDate ?? null;
  if (has('projectId')) data.projectId = ticket.projectId ?? null;
  if (has('status') && TICKET_TO_TASK[ticket.status]) data.status = TICKET_TO_TASK[ticket.status];

  if (has('assigneeId')) {
    let ids = task.assignees.map((a) => a.userId).filter((id) => id !== prevAssigneeId); // drop the previous owner, keep helpers
    if (ticket.assigneeId && !ids.includes(ticket.assigneeId)) ids = [ticket.assigneeId, ...ids];
    data.assigneeId = ids[0] ?? null;
    data.assignees = { deleteMany: {}, create: ids.map((userId) => ({ userId })) };
  }
  return Object.keys(data).length ? db.task.update({ where: { id: task.id }, data }) : task;
}

/** When the auto task changes status, move the ticket along with it. */
export async function syncTicketFromTask(db, task, { actor } = {}) {
  if (!task.autoCreated || !task.ticketId) return null;
  const ticket = await db.ticket.findUnique({ where: { id: task.ticketId } });
  const next = TASK_TO_TICKET[task.status];
  if (!ticket || !next || next === ticket.status || TICKET_TO_TASK[ticket.status] === task.status) return null; // already consistent
  const updated = await db.ticket.update({ where: { id: ticket.id }, data: { status: next } });
  await logActivity({
    actorId: actor?.id, organizationId: updated.organizationId, entityType: 'ticket', entityId: updated.id, action: 'updated',
    summary: `Ticket ${updated.key} moved to ${next.replaceAll('_', ' ').toLowerCase()} (task progress)`,
    metadata: { visibility: updated.visibility, requesterId: updated.requesterId },
  });
  return updated;
}
