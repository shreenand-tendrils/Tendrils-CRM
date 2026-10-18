import { prisma } from '../db.js';
import { notifyUser } from './activity.js';
import { sendNotificationEmail, fireAndLog } from './email.service.js';

/** In-app notification + best-effort email for each person (never the actor). */
export async function notifyPeople({ userIds, actorId, type = 'SYSTEM', title, body, href, email = true }) {
  const ids = [...new Set(userIds)].filter((id) => id && id !== actorId);
  if (!ids.length) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  for (const u of users) {
    await notifyUser({ userId: u.id, type, title, body, href });
    if (email && u.email) fireAndLog(sendNotificationEmail({ to: u.email, name: u.name, subject: title, message: body, href }));
  }
}

/** Active internal people who triage incoming client work (managers, admins, team leads). */
export async function findTriagers() {
  return prisma.user.findMany({
    where: { memberships: { some: { isActive: true, role: { in: ['PLATFORM_ADMIN', 'MANAGER', 'TEAM_LEAD'] }, organization: { type: 'INTERNAL', isActive: true } } } },
    select: { id: true },
  });
}

/** Active client-workspace users of an organization (optionally only client admins). */
export async function findClientUsers(organizationId, { adminsOnly = false, userIds } = {}) {
  return prisma.user.findMany({
    where: { ...(userIds ? { id: { in: userIds } } : {}), memberships: { some: { organizationId, isActive: true, role: adminsOnly ? 'CLIENT_ADMIN' : { in: ['CLIENT_ADMIN', 'CLIENT_MEMBER'] } } } },
    select: { id: true },
  });
}
