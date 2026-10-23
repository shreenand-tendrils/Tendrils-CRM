import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { logActivity } from './activity.js';
import { notifyPeople, findClientUsers } from './notify.service.js';
import { recordTicketEvents } from './ticketHistory.service.js';
import { collectTicketTasks, syncTaskFromTicket } from './ticketTask.service.js';
import { incompleteWorkTasks } from './ticketWorkRules.js';

// What happens to the ticket when its last task is approved: 'CLOSED' (default; the client already reviewed every task)
// or 'REVIEW_TEST' (ask the client for one more final OK). One switch, nothing else to change.
export const ON_LAST_APPROVAL = 'CLOSED';

// Client review of ONE task on a client ticket.
//   team: moves a top-level task to Review      -> recordClientReviewRequest (client is told, ticket shows "Being tested")
//   client: Approve / Request changes on a task -> reviewTaskAsClient
//   When the client approves the LAST open task the ticket moves on by itself (see ON_LAST_APPROVAL): the client has reviewed all the work.

/** A top-level task of a client ticket just entered Review: tell the client and the ticket history. */
export async function recordClientReviewRequest(db, { task, ticket, actor }) {
  if (ticket.status === 'OPEN') await db.ticket.update({ where: { id: ticket.id }, data: { progress: 'QA' } });
  await recordTicketEvents(db, ticket.id, actor?.id, [{ type: 'TASK_REVIEW', toValue: 'REQUESTED', toLabel: task.title, note: 'Ready for client review', clientVisible: true }]);
  const admins = ticket.organizationId ? await findClientUsers(ticket.organizationId, { adminsOnly: true }) : [];
  await notifyPeople({
    userIds: [ticket.requesterId, ...admins.map((u) => u.id)].filter(Boolean), actorId: actor?.id, type: 'APPROVAL',
    title: `${ticket.key}: “${task.title}” is ready for your review`, body: 'Open the ticket to approve it or ask for changes.', href: `/?ticket=${ticket.id}`,
  });
}

/** decision: 'APPROVE' | 'CHANGES'. `ticket` must already be checked as visible to this client. */
export async function reviewTaskAsClient({ ticket, taskId, decision, note, actor }) {
  if (ticket.status === 'CLOSED') throw new AppError('This ticket is already closed.', 409, 'TICKET_ALREADY_APPROVED');
  const task = await prisma.task.findFirst({ where: { id: taskId, ticketId: ticket.id }, include: { assignees: true } });
  if (!task || task.autoCreated) throw new AppError('Task not found', 404);
  if (task.parentId) throw new AppError('Subtasks are the team’s own checklist. Review the parent task instead.', 409, 'SUBTASK_NOT_REVIEWABLE');
  if (task.status !== 'REVIEW') throw new AppError('This task is not waiting for your review.', 409, 'TASK_NOT_IN_REVIEW');
  const cleanNote = (note || '').trim();
  const plain = cleanNote.replace(/\[\[img:[\w-]+\]\]/g, '[image]').replace(/\[Pasted image: [^\]]*\]/g, '[image]').trim();
  if (decision === 'CHANGES' && plain.length < 2 && !/\[\[img:/.test(cleanNote)) throw new AppError('Tell the team what to change.', 400, 'NOTE_REQUIRED');

  const who = actor.name || actor.email;
  const result = await prisma.$transaction(async (tx) => {
    if (decision === 'APPROVE') {
      const updatedTask = await tx.task.update({ where: { id: task.id }, data: { status: 'DONE', completedAt: new Date() } });
      await recordTicketEvents(tx, ticket.id, actor.id, [{ type: 'TASK_REVIEW', toValue: 'APPROVED', toLabel: task.title, note: plain || null, clientVisible: true }]);
      const allApproved = incompleteWorkTasks(await collectTicketTasks(tx, ticket.id)).length === 0;
      if (!allApproved || ticket.status !== 'OPEN') return { task: updatedTask, ticket, closed: false, allApproved };
      const toClose = ON_LAST_APPROVAL === 'CLOSED';
      const moved = await tx.ticket.update({ where: { id: ticket.id }, data: toClose ? { status: 'CLOSED', progress: null, closedAt: new Date() } : { status: 'REVIEW_TEST', progress: 'RESOLVED', closedAt: null } });
      await syncTaskFromTicket(tx, moved, { changed: ['status', 'progress'], actor });
      await recordTicketEvents(tx, ticket.id, actor.id, [{ type: 'STATUS', fromValue: ticket.progress ? `${ticket.status}:${ticket.progress}` : ticket.status, toValue: toClose ? 'CLOSED' : 'REVIEW_TEST:RESOLVED', note: 'Client approved the last task', clientVisible: true }]);
      return { task: updatedTask, ticket: moved, closed: toClose, allApproved };
    }
    const updatedTask = await tx.task.update({ where: { id: task.id }, data: { status: 'IN_PROGRESS', completedAt: null } });
    const nextTicket = ticket.status === 'OPEN' ? await tx.ticket.update({ where: { id: ticket.id }, data: { progress: 'IN_PROGRESS' } }) : ticket;
    await tx.comment.create({ data: { body: `Changes requested on “${task.title}”: ${cleanNote}`, visibility: 'CLIENT', ticketId: ticket.id, authorId: actor.id } });
    await tx.comment.create({ data: { body: `Client requested changes: ${cleanNote}`, visibility: 'INTERNAL', taskId: task.id, authorId: actor.id } });
    await recordTicketEvents(tx, ticket.id, actor.id, [{ type: 'TASK_REVIEW', toValue: 'CHANGES', toLabel: task.title, note: plain.slice(0, 140), clientVisible: true }]);
    return { task: updatedTask, ticket: nextTicket, closed: false };
  });

  await logActivity({
    actorId: actor.id, organizationId: ticket.organizationId, entityType: 'ticket', entityId: ticket.id, action: 'updated',
    summary: decision === 'APPROVE' ? `${ticket.key}: client approved “${task.title}”${result.allApproved ? ' (last open task)' : ''}` : `${ticket.key}: client asked for changes on “${task.title}”`,
    metadata: { visibility: ticket.visibility, requesterId: ticket.requesterId },
  });
  const team = [...new Set([...task.assignees.map((a) => a.userId), task.assigneeId, ticket.assigneeId].filter(Boolean))];
  await notifyPeople({
    userIds: team, actorId: actor.id, type: 'STATUS_CHANGE', href: `/?task=${task.id}`,
    title: decision === 'APPROVE' ? `Client approved “${task.title}”${result.closed ? ` — ${ticket.key} is closed` : result.allApproved ? ` — all tasks of ${ticket.key} are approved` : ''}` : `Client asked for changes on “${task.title}”`,
    body: decision === 'APPROVE' ? (result.allApproved ? `${who} approved the last task, so ${ticket.key} ${result.closed ? 'is now closed.' : 'moved to Review/Test for the final OK.'}` : `${who} approved the work.`) : `${who}: ${plain.slice(0, 200)}`,
  });
  return result;
}
