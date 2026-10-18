import { prisma } from '../db.js';
import { orgScope, activityScope } from '../middleware/index.js';

const actorSelect = { actor: { select: { name: true, email: true } } };

export const workspaceRepository = {
  findOrganizationsForUser(req) {
    const where = req.isInternal ? {} : { id: { in: req.memberships.map((m) => m.organizationId) } };
    return prisma.organization.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { projects: true, tickets: true, memberships: true } } },
    });
  },
  findRecentActivity(req, limit = 8) {
    return prisma.activityLog.findMany({ where: activityScope(req), orderBy: { createdAt: 'desc' }, take: limit, include: actorSelect });
  },
  orgScope,
};
