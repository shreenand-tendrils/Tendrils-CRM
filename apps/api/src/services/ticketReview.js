import { prisma } from '../db.js';
import { notifyPeople, findTeamManagers } from './notify.service.js';

export { MANAGER_REVIEW_STATUSES, NEEDS_MANAGER_REVIEW_MESSAGE, finishBlocked } from './ticketReviewRules.js';

/** Set of user ids (from `userIds`) who are active Employees of the internal organization. */
export async function employeeIds(db, userIds = []) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const rows = await db.membership.findMany({ where: { userId: { in: ids }, role: 'EMPLOYEE', isActive: true, organization: { type: 'INTERNAL' } }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

/** Tell the managers of the ticket's teams that it is waiting for their review. */
export async function notifyReviewReady(ticket, actor) {
  const access = await prisma.ticketTeamAccess.findMany({ where: { ticketId: ticket.id }, select: { teamId: true } });
  const ids = access.map((a) => a.teamId);
  const managers = ids.length ? await findTeamManagers(ids) : [];
  await notifyPeople({
    userIds: managers.map((m) => m.id), actorId: actor?.id, type: 'APPROVAL', title: `${ticket.key} is ready for your review`,
    body: `${actor?.name || actor?.email || 'A team member'} moved it to Review: ${ticket.title}`, href: `/?ticket=${ticket.id}`,
  });
}
