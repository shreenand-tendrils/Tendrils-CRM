import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { logActivity } from './activity.js';
import { notifyPeople, findClientUsers } from './notify.service.js';
import { recordTicketEvents } from './ticketHistory.service.js';
import { collectTicketTasks, syncTaskFromTicket } from './ticketTask.service.js';

/**
 * One module for every review / completion rule on tickets and tasks.
 * Pure rules sit on top (no DB, unit-tested); the client-review workflow that
 * needs transactions lives at the bottom. The web UI mirrors the pure rules
 * (apps/web/src/lib/taskReview.js) but the API is always the authority.
 */

// ---------------------------------------------------------------------------------------------
// Ticket finish/delete rules (was ticketReviewRules.js + ticketWorkRules.js)
// A ticket raised by a client must be submitted for client review by the team working on it.
// A ticket an employee raised (team-to-team work) can be finished by the employees who may edit it.
export const MANAGER_REVIEW_STATUSES = ['RESOLVED', 'CLOSED', 'CLIENT_REVIEW'];
export const NEEDS_MANAGER_REVIEW_MESSAGE = 'Submit the completed ticket for client review once all linked work is complete.';

/** Pure rule: true when this person may NOT move the ticket to `status`. */
export const finishBlocked = ({ internal, canTriage, status, requesterIsEmployee }) =>
  Boolean(internal && !canTriage && !requesterIsEmployee && MANAGER_REVIEW_STATUSES.includes(status));

/** Managers/admins can delete any ticket they can see. The person who raised it may delete it only while it is untouched (a mistake window). */
export const canDeleteTicket = ({ canDeleteAny, isRequester, status, assigneeId, othersCommented }) =>
  Boolean(canDeleteAny || (isRequester && status === 'OPEN' && !assigneeId && !othersCommented));

/** Actual linked work must be DONE before a ticket is submitted for review or closed. */
export function incompleteWorkTasks(tasks = []) {
  // The auto-created task mirrors the ticket status; other linked tasks/subtasks are real work.
  return tasks.filter((task) => !task.autoCreated && task.status !== 'DONE');
}

// ---------------------------------------------------------------------------------------------
// Task review rules (was taskReviewRules.js). Pure functions.

/** Review authority for tasks routed across teams. */
export const taskReviewerTeamIds = (creatorTeamIds = [], destinationTeamId = null) =>
  [...new Set(creatorTeamIds.filter((id) => id && id !== destinationTeamId))];

export const canApproveTask = ({ canUpdateAny = false, actorTeamIds = [], reviewerTeamIds = [] } = {}) =>
  Boolean(canUpdateAny || reviewerTeamIds.some((id) => actorTeamIds.includes(id)));

export const taskNeedsTeamReview = (reviewerTeamIds = []) => reviewerTeamIds.length > 0;

// ---------------------------------------------------------------------------------------------
// WHO REVIEWS A TASK? (single source of truth, mirrored by apps/web/src/lib/taskReview.js)
//   TICKET : the ticket's auto-created mirror record. Never moved by hand; the ticket drives it.
//   NONE   : subtasks, and self-managed tasks (creator is the assignee, or nobody is assigned).
//            The doer ticks them Done directly. A parent still waits for its subtasks.
//   CLIENT : a top-level task on a client ticket. The CLIENT approves it (or asks for changes) from the ticket.
//   TEAM   : a task one team sent to another. The requesting (REVIEWER) team approves it.
//   PEER   : a task someone else created for the assignee inside the same team. Any teammate who is not
//            an assignee (or the creator) approves it.
// ---------------------------------------------------------------------------------------------
export const REVIEW_KINDS = ['TICKET', 'NONE', 'CLIENT', 'TEAM', 'PEER'];

export function reviewAuthorityOf({ autoCreated = false, parentId = null, ticketIsClient = false, reviewerTeamIds = [], creatorId = null, assigneeIds = [] } = {}) {
  if (autoCreated) return 'TICKET';
  if (parentId) return 'NONE';
  if (ticketIsClient) return 'CLIENT';
  if (reviewerTeamIds.length) return 'TEAM';
  if (assigneeIds.length && creatorId && !assigneeIds.includes(creatorId)) return 'PEER';
  return 'NONE';
}

/** Can this person move the task to Done (or reopen a Done task)? Admins (task.update_any) always can, except on mirror records. */
export function canFinishTask({ authority, actorId, canUpdateAny = false, actorTeamIds = [], reviewerTeamIds = [], workTeamIds = [], creatorId = null, assigneeIds = [] } = {}) {
  if (authority === 'TICKET') return false;
  if (authority === 'NONE') return true;
  if (canUpdateAny) return true;
  if (authority === 'CLIENT') return false;
  if (assigneeIds.includes(actorId)) return false; // TEAM and PEER: never the doer reviewing their own work
  if (authority === 'TEAM') return canApproveTask({ actorTeamIds, reviewerTeamIds });
  return actorId === creatorId || workTeamIds.some((id) => actorTeamIds.includes(id));
}

/** Plain-language explanation used by API errors and the UI. */
export const REVIEW_HINT = {
  TICKET: 'This record mirrors its ticket. The ticket drives it; do not move it by hand.',
  NONE: 'No review needed: mark it Done when you finish.',
  CLIENT: 'This task is reviewed by the client. Submit it to Review and the client approves it or asks for changes.',
  TEAM: 'Submit finished work to Review. The team that requested it approves it.',
  PEER: 'Submit finished work to Review. A teammate (not the assignee) approves it.',
};

// ---------------------------------------------------------------------------------------------
// Small collaborators (was taskComments.js + assignees.js fragments)

/** Who hears about a new task comment: everyone on the task plus its creator, never the author, no duplicates. */
export function taskCommentRecipients(task, authorId) {
  const ids = [task.creatorId, task.assigneeId, ...(task.assignees || []).map((a) => a.userId ?? a.user?.id)];
  return [...new Set(ids.filter((id) => id && id !== authorId))];
}

/**
 * Normalise assignee input. `assigneeIds` (multi) wins over legacy `assigneeId`.
 * Returns undefined when the caller didn't touch assignees.
 */
export function resolveAssignees({ assigneeIds, assigneeId } = {}) {
  if (assigneeIds !== undefined) return [...new Set(assigneeIds)];
  if (assigneeId === null) return [];
  if (assigneeId) return [assigneeId];
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Client review of ONE task on a client ticket (was taskClientReview.js).
//   team: moves a top-level task to Review      -> recordClientReviewRequest (client is told, ticket shows "Being tested")
//   client: Approve / Request changes on a task -> reviewTaskAsClient
//   When the client approves the LAST open task the ticket moves on by itself (see ON_LAST_APPROVAL): the client has reviewed all the work.

// What happens to the ticket when its last task is approved: 'CLOSED' (default; the client already reviewed every task)
// or 'REVIEW_TEST' (ask the client for one more final OK). One switch, nothing else to change.
export const ON_LAST_APPROVAL = 'CLOSED';

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
