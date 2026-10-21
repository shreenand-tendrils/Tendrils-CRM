import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';

/** Assignee must be an active member of an INTERNAL organization. */
export async function assertAssignable(userId) {
  if (!userId) return;
  const ok = await prisma.membership.findFirst({
    where: { userId, isActive: true, organization: { type: 'INTERNAL' } },
    select: { id: true },
  });
  if (!ok) throw new AppError('Assignee must be an active Tendrils staff member', 400, 'INVALID_ASSIGNEE');
}

export async function assertProjectInOrg(projectId, organizationId) {
  if (!projectId) return;
  const p = await prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
  if (!p) throw new AppError('Project does not belong to selected client', 400, 'INVALID_PROJECT');
}

export async function assertTicketInOrg(ticketId, organizationId) {
  if (!ticketId) return;
  const t = await prisma.ticket.findFirst({ where: { id: ticketId, organizationId }, select: { id: true } });
  if (!t) throw new AppError('Ticket does not belong to selected client', 400, 'INVALID_TICKET');
}

export async function assertInternalTeam(teamId) {
  if (!teamId) return;
  const t = await prisma.team.findFirst({ where: { id: teamId, isActive: true, organization: { type: 'INTERNAL' } }, select: { id: true } });
  if (!t) throw new AppError('Team not found or no longer active', 400, 'INVALID_TEAM');
}

/** Every id must be an active member of an INTERNAL organization. */
export async function assertAssignees(ids = []) {
  if (!ids.length) return;
  const found = await prisma.membership.findMany({
    where: { userId: { in: ids }, isActive: true, organization: { type: 'INTERNAL' } },
    select: { userId: true },
    distinct: ['userId'],
  });
  if (found.length !== new Set(ids).size) throw new AppError('All assignees must be active Tendrils staff members', 400, 'INVALID_ASSIGNEE');
}

export const getInternalOrgId = (req) => req.memberships.find((m) => m.organization.type === 'INTERNAL')?.organizationId;

/** Active employees/platform admins of the internal org (recipients of daily updates). */
export function findAdmins() {
  return prisma.user.findMany({
    where: { memberships: { some: { isActive: true, role: { in: ['PLATFORM_ADMIN', 'EMPLOYEE'] }, organization: { type: 'INTERNAL' } } } },
    select: { id: true, name: true, email: true },
  });
}

/** Map<teamId, Set<userId>> of ACTIVE members for the given teams. */
export async function loadTeamMemberIds(teamIds = []) {
  const map = new Map(teamIds.map((id) => [id, new Set()]));
  if (!teamIds.length) return map;
  const rows = await prisma.teamMember.findMany({
    where: { teamId: { in: teamIds }, membership: { isActive: true, organization: { type: 'INTERNAL' } } },
    select: { teamId: true, membership: { select: { userId: true } } },
  });
  for (const r of rows) map.get(r.teamId)?.add(r.membership.userId);
  return map;
}
