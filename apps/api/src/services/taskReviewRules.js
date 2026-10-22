/** Review authority for tasks routed across teams. */
export const taskReviewerTeamIds = (creatorTeamIds = [], destinationTeamId = null) =>
  [...new Set(creatorTeamIds.filter((id) => id && id !== destinationTeamId))];

export const canApproveTask = ({ canUpdateAny = false, actorTeamIds = [], reviewerTeamIds = [] } = {}) =>
  Boolean(canUpdateAny || reviewerTeamIds.some((id) => actorTeamIds.includes(id)));

export const taskNeedsTeamReview = (reviewerTeamIds = []) => reviewerTeamIds.length > 0;

// ---------------------------------------------------------------------------------------------
// WHO REVIEWS A TASK? (single source of truth, mirrored by apps/web/src/lib/rbac.js)
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
  if (authority === 'TEAM') return canApproveTask({ actorTeamIds, reviewerTeamIds });
  if (assigneeIds.includes(actorId)) return false; // PEER: somebody other than the doer
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
