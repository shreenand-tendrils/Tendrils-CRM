import { prisma } from '../db.js';
import { STAFF_ROLES, MANAGER_ROLES, permissionsFor } from '../rbac/permissions.js';

export { STAFF_ROLES, MANAGER_ROLES };

export function deriveFlags(memberships) {
  const internal = memberships.filter((m) => m.organization.type === 'INTERNAL');
  return {
    isInternal: internal.some((m) => STAFF_ROLES.includes(m.role)),
    isManager: internal.some((m) => MANAGER_ROLES.includes(m.role)),
  };
}

const include = {
  memberships: {
    where: { isActive: true, organization: { isActive: true } },
    include: { organization: true, teamMemberships: { include: { team: true } } },
  },
};

async function toContext(user) {
  if (!user || !user.memberships.length) return null;
  const permissions = permissionsFor(user.memberships);
  return { currentUser: user, memberships: user.memberships, ...deriveFlags(user.memberships), permissions, can: (p) => permissions.has(p) };
}

/** Request context ({currentUser, memberships, isInternal, isManager}) or null if the account has no active membership. */
export const loadContextByEmail = async (email) => toContext(await prisma.user.findUnique({ where: { email }, include }));
export const loadContextByUserId = async (id) => toContext(await prisma.user.findUnique({ where: { id }, include }));
