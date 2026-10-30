/**
 * Row-level access policy: which records a request's memberships let it see.
 * These are Prisma `where` clauses (policy), not middleware — they live in rbac/
 * next to permissions.js and policies.js. middleware/auth.middleware.js still
 * re-exports them for the existing import surface.
 */

import { MANAGER_ROLES } from './permissions.js';

// Manager = PLATFORM_ADMIN inside the INTERNAL org only.
export const isManager = (req) =>
  req.memberships.some((m) => m.organization.type === 'INTERNAL' && MANAGER_ROLES.includes(m.role));

export const canSeeOrg = (req, orgId) =>
  Boolean(orgId) && (req.isInternal || req.memberships.some((m) => m.organizationId === orgId));

const memberOrgIds = (req) => req.memberships.map((m) => m.organizationId);

/** Tenant filter for org-owned records (projects, tickets, tasks). */
export const orgScope = (req) => (req.isInternal ? {} : { organizationId: { in: memberOrgIds(req) } });

export const internalTeamIds = (req) => [...new Set((req.memberships || []).flatMap((m) => (m.teamMemberships || []).map((tm) => tm.teamId)))];
const isPlatformAdmin = (req) => (req.memberships || []).some((m) => m.organization?.type === 'INTERNAL' && m.role === 'PLATFORM_ADMIN');

/** Strict team boundary: internal users see only tickets explicitly shared with one of their teams.
 * Platform admins retain global oversight. Unrouted tickets are visible to triagers so they can route them.
 */
export const ticketScope = (req) => {
  if (req.isInternal) {
    if (isPlatformAdmin(req)) return {};
    const teamIds = internalTeamIds(req);
    const clauses = [];
    if (teamIds.length) clauses.push({ teamAccesses: { some: { teamId: { in: teamIds } } } });
    if (req.can('ticket.triage')) {
      clauses.push({ teamAccesses: { none: {} }, teamId: null });
      // A manager who routed a ticket to another team keeps seeing it (otherwise it "disappears" from their list).
      clauses.push({ teamAccesses: { some: { addedById: req.currentUser.id } } });
    }
    // Whoever holds the ticket must always be able to see it.
    clauses.push({ assigneeId: req.currentUser.id });
    clauses.push({ requesterId: req.currentUser.id }); // staff keep tickets they raised for other teams
    return { OR: clauses };
  }
  return {
    visibility: 'CLIENT',
    OR: req.memberships.map((m) => ({ organizationId: m.organizationId, ...(m.role === 'CLIENT_ADMIN' ? {} : { requesterId: req.currentUser.id }) })),
  };
};

export const taskTeamScope = (req) => {
  if (!req.isInternal) return { id: '__no_task_access__' };
  if (isPlatformAdmin(req)) return {};
  const teamIds = internalTeamIds(req);
  const clauses = [];
  if (teamIds.length) clauses.push({ teamAccesses: { some: { teamId: { in: teamIds } } } });
  if (teamIds.length) clauses.push({ ticket: { is: { teamAccesses: { some: { teamId: { in: teamIds } } } } } });
  if (teamIds.length) clauses.push({ parent: { is: { teamAccesses: { some: { teamId: { in: teamIds } } } } } });
  clauses.push({ creatorId: req.currentUser.id }); // creators keep tasks they made for other teams
  clauses.push({ assigneeId: req.currentUser.id });
  return { OR: clauses };
};

/**
 * Activity visibility (audit vs feed):
 *  - Admins/managers (admin.view): everything, including 'access' events (invites, role changes) = the audit log.
 *  - Other staff: all work activity (projects, tickets, tasks, teams, daily updates) but never 'access' events.
 *  - Clients: a curated timeline of THEIR org only: project events/updates and tickets they may see (CLIENT-visible).
 *    Tasks, teams, access changes and internal items never reach clients.
 */
export const activityScope = (req) => {
  if (req.isInternal) return req.can('admin.view') ? {} : { entityType: { not: 'access' } };
  const me = req.currentUser.id;
  const orgIds = memberOrgIds(req);
  const ticketClauses = req.memberships.map((m) => ({
    organizationId: m.organizationId,
    entityType: 'ticket',
    AND: [
      { metadata: { path: ['visibility'], equals: 'CLIENT' } },
      ...(m.role === 'CLIENT_ADMIN' ? [] : [{ metadata: { path: ['requesterId'], equals: me } }]),
    ],
  }));
  return { organizationId: { in: orgIds }, OR: [{ entityType: 'project' }, ...ticketClauses] };
};
