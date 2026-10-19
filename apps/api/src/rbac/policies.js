// Resource-level rules that need the record itself (not just the role). Pure functions: easy to unit-test.
import { STAFF_ROLES } from './permissions.js';

const me = (ctx) => ctx.currentUser.id;

export function canEditTask(ctx, task) {
  if (ctx.can('task.update_any')) return true;
  if (!ctx.can('task.update_own')) return false;
  return task.creatorId === me(ctx) || task.assigneeId === me(ctx) || (task.assignees || []).some((a) => (a.userId ?? a.user?.id) === me(ctx));
}

const isClientAdminOf = (ctx, orgId) => ctx.memberships.some((m) => m.organizationId === orgId && m.role === 'CLIENT_ADMIN');

/** Can this person see the ticket at all? Client admins see their whole org, client members only what they raised. */
export function canViewTicket(ctx, t) {
  if (ctx.isInternal) {
    if (ctx.memberships.some((m) => m.organization?.type === 'INTERNAL' && m.role === 'PLATFORM_ADMIN')) return true;
    const myTeamIds = new Set((ctx.memberships || []).flatMap((m) => (m.teamMemberships || []).map((tm) => tm.teamId)));
    const allowed = (t.teamAccesses || []).some((a) => myTeamIds.has(a.teamId));
    // A not-yet-routed ticket is available to authorized triagers only, never to unrelated teams.
    return allowed || (ctx.can('ticket.triage') && !t.teamId && !(t.teamAccesses || []).length);
  }
  if (t.visibility !== 'CLIENT') return false;
  if (!ctx.memberships.some((m) => m.organizationId === t.organizationId)) return false;
  return isClientAdminOf(ctx, t.organizationId) || t.requesterId === me(ctx);
}

/** Clients may only approve (CLOSED) or send back (IN_PROGRESS) a ticket that is waiting in CLIENT_REVIEW. */
export const CLIENT_REVIEW_OUTCOMES = ['CLOSED', 'IN_PROGRESS'];
export const clientStatusChangeAllowed = (currentStatus, nextStatus) => currentStatus === 'CLIENT_REVIEW' && CLIENT_REVIEW_OUTCOMES.includes(nextStatus);

export const TICKET_FIELDS = {
  full: ['title', 'description', 'status', 'priority', 'visibility', 'assigneeId', 'teamId', 'teamIds', 'projectId', 'dueDate'],
  status: ['status'],
  own: ['title', 'description', 'status', 'priority', 'dueDate'],
  client: ['title', 'description', 'priority', 'status'], // 'status' is further limited by clientStatusChangeAllowed
  none: [],
};

/** Which ticket fields may this person change? */
export function ticketEditScope(ctx, t) {
  if (ctx.isInternal) {
    if (ctx.can('ticket.triage')) return 'full';
    if (ctx.can('ticket.update_own') && t.requesterId === me(ctx)) return 'own';
    if (ctx.can('ticket.update_own') && t.assigneeId === me(ctx)) return 'status';
    return 'none';
  }
  return t.requesterId === me(ctx) || isClientAdminOf(ctx, t.organizationId) ? 'client' : 'none';
}

/**
 * Validate a membership change by an admin. Returns an error string or null.
 * actor: { id, can }, target: { userId, role }, change: { role?, isActive? }, otherActiveAdmins: number
 */
export function checkMemberChange({ actor, target, change, otherActiveAdmins }) {
  if (target.userId === actor.id) return "You can't change your own access. Ask another admin.";
  const touchesAdmin = target.role === 'PLATFORM_ADMIN' || change.role === 'PLATFORM_ADMIN';
  if (touchesAdmin && !actor.can('member.grant_admin')) return 'Only a Platform admin can grant, change or remove Platform admins.';
  const losesAdmin = target.role === 'PLATFORM_ADMIN' && ((change.role && change.role !== 'PLATFORM_ADMIN') || change.isActive === false);
  if (losesAdmin && otherActiveAdmins < 1) return 'There must always be at least one active Platform admin.';
  return null;
}

/** Can this person post a client-visible update on the project? Staff with the permission, or members of that project. */
export const canPostProjectUpdate = (ctx, project) =>
  ctx.isInternal && (ctx.can('project.post_update') || (project.members || []).some((m) => (m.userId ?? m.user?.id) === ctx.currentUser.id));

/** Validate an invitation / manual grant. Returns an error string or null. */
export function checkGrant({ actorCan, role, orgType }) {
  if (!roleFitsOrgType(role, orgType)) return `${role.replaceAll('_', ' ').toLowerCase()} is not a valid role in a ${orgType.toLowerCase()} workspace`;
  if (role === 'PLATFORM_ADMIN' && !actorCan('member.grant_admin')) return 'Only a Platform admin can grant Platform admin.';
  return null;
}

export const roleFitsOrgType = (role, orgType) => (orgType === 'INTERNAL' ? STAFF_ROLES.includes(role) : !STAFF_ROLES.includes(role));
