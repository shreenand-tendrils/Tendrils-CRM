// Pure manager-review rules (no database access, unit-tested).
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
