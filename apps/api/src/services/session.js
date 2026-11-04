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

/** One email can be both an employee (internal workspace) and a client. `mode` (EMPLOYEE | CLIENT) picks which side this request acts as;
 *  without a mode (or when that side doesn't exist for the user) every membership applies, exactly as before. */
export const MODES = ['EMPLOYEE', 'CLIENT'];
async function toContext(user, mode) {
  if (!user || !user.memberships.length) return null;
  const isEmp = (m) => m.organization.type === 'INTERNAL';
  const modes = [user.memberships.some(isEmp) && 'EMPLOYEE', user.memberships.some((m) => !isEmp(m)) && 'CLIENT'].filter(Boolean);
  const active = modes.length > 1 && MODES.includes(mode) ? user.memberships.filter((m) => (mode === 'EMPLOYEE') === isEmp(m)) : user.memberships;
  const permissions = permissionsFor(active);
  return { currentUser: user, memberships: active, modes, mode: modes.length > 1 && MODES.includes(mode) ? mode : null, ...deriveFlags(active), permissions, can: (p) => permissions.has(p) };
}

/** Request context ({currentUser, memberships, isInternal, isManager}) or null if the account has no active membership. */
export const loadContextByEmail = async (email, mode) => toContext(await prisma.user.findUnique({ where: { email }, include }), mode);
export const loadContextByUserId = async (id, mode) => toContext(await prisma.user.findUnique({ where: { id }, include }), mode);
