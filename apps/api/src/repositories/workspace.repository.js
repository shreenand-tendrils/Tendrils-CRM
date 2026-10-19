import { prisma } from '../db.js';
import { orgScope, activityScope, ticketScope, taskTeamScope } from '../middleware/index.js';

const actorSelect = { actor: { select: { name: true, email: true } } };

export async function safeActivityScope(req) {
  const base = activityScope(req);
  if (!req.isInternal || req.memberships.some((m) => m.organization?.type === 'INTERNAL' && m.role === 'PLATFORM_ADMIN')) return base;
  const [tickets, tasks] = await Promise.all([
    prisma.ticket.findMany({ where: ticketScope(req), select: { id: true } }),
    prisma.task.findMany({ where: taskTeamScope(req), select: { id: true } }),
  ]);
  return { AND: [base, { OR: [
    { entityType: { notIn: ['ticket', 'task'] } },
    { entityType: 'ticket', entityId: { in: tickets.map((x) => x.id) } },
    { entityType: 'task', entityId: { in: tasks.map((x) => x.id) } },
  ] }] };
}

export const workspaceRepository = {
  findOrganizationsForUser(req) {
    const where = req.isInternal ? {} : { id: { in: req.memberships.map((m) => m.organizationId) } };
    return prisma.organization.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { projects: true, tickets: true, memberships: true } } },
    });
  },
  async findRecentActivity(req, limit = 8) {
    return prisma.activityLog.findMany({ where: await safeActivityScope(req), orderBy: { createdAt: 'desc' }, take: limit, include: actorSelect });
  },
  orgScope,
};
