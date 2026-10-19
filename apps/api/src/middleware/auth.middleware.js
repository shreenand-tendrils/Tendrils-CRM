import { getSession } from '@auth/express';
import { authConfig } from '../auth.js';
import { loadContextByEmail, STAFF_ROLES, MANAGER_ROLES } from '../services/session.js';
import { devEmailFromCookieHeader } from '../services/devAuth.js';
import { acceptInvitesForEmail } from '../services/invitations.service.js';

export async function requireUser(req, res, next) {
  try {
    const devEmail = devEmailFromCookieHeader(req.headers.cookie); // null unless DEV_LOGIN=true (non-production)
    let email = devEmail;
    if (!email) {
      const session = await getSession(req, authConfig);
      email = session?.user?.email?.toLowerCase();
    }
    if (!email) return res.status(401).json({ error: 'Sign in required' });
    // Access is membership-based (any invited email). The session email was verified by Google at sign-in.
    let ctx = await loadContextByEmail(email);
    if (!ctx && !devEmail && (await acceptInvitesForEmail(email))) ctx = await loadContextByEmail(email); // invited after they first signed in
    if (!ctx) return res.status(403).json({ error: 'Your account has no active membership. Ask a Tendrils administrator to invite you.', code: 'NO_MEMBERSHIP' });

    req.currentUser = ctx.currentUser;
    req.memberships = ctx.memberships;
    req.isInternal = ctx.isInternal;
    req.isManager = ctx.isManager;
    req.permissions = ctx.permissions;
    req.can = ctx.can;
    next();
  } catch (e) {
    next(e);
  }
}

// Manager = PLATFORM_ADMIN/MANAGER inside the INTERNAL org only.
export const isManager = (req) =>
  req.memberships.some((m) => m.organization.type === 'INTERNAL' && MANAGER_ROLES.includes(m.role));
export const canSeeOrg = (req, orgId) =>
  Boolean(orgId) && (req.isInternal || req.memberships.some((m) => m.organizationId === orgId));

export const requireManager = (req, res, next) =>
  isManager(req) ? next() : res.status(403).json({ error: 'Manager permission required' });
export const requireInternal = (req, res, next) =>
  req.isInternal ? next() : res.status(403).json({ error: 'Internal staff access required' });

/** RBAC gate: allow the request only if the user's role grants `permission`. */
export const requirePermission = (permission) => (req, res, next) =>
  req.can(permission) ? next() : res.status(403).json({ error: `You don't have permission to do this (${permission}).`, permission });

const memberOrgIds = (req) => req.memberships.map((m) => m.organizationId);

/** Tenant filter for org-owned records (projects, tickets, tasks). */
export const orgScope = (req) => (req.isInternal ? {} : { organizationId: { in: memberOrgIds(req) } });

/** Tickets: staff see all; client admins see their org's client-visible tickets; client members only the ones they raised. */
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
  return { OR: clauses.length ? clauses : [{ id: '__no_task_access__' }] };
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
