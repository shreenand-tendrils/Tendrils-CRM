// Pure manager-review rules (no database access, unit-tested).
// A ticket raised by a client or a manager must be reviewed by a manager before it can go to the client, be resolved or closed.
// A ticket an employee raised (team-to-team work) can be finished by the employees who may edit it.
export const MANAGER_REVIEW_STATUSES = ['RESOLVED', 'CLOSED', 'CLIENT_REVIEW'];
export const NEEDS_MANAGER_REVIEW_MESSAGE = 'This ticket came from a client or a manager, so an employee can review it first. Move it to Review and your manager will send it to the client, resolve or close it.';

/** Pure rule: true when this person may NOT move the ticket to `status`. */
export const finishBlocked = ({ internal, canTriage, status, requesterIsEmployee }) =>
  Boolean(internal && !canTriage && !requesterIsEmployee && MANAGER_REVIEW_STATUSES.includes(status));


/** Managers/admins can delete any ticket they can see. The person who raised it may delete it only while it is untouched (a mistake window). */
export const canDeleteTicket = ({ canDeleteAny, isRequester, status, assigneeId, othersCommented }) =>
  Boolean(canDeleteAny || (isRequester && status === 'OPEN' && !assigneeId && !othersCommented));
