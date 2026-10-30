import { getSession } from '@auth/express';
import { authConfig } from '../auth.js';
import { loadContextByEmail, loadContextByUserId } from '../services/session.js';
import { devEmailFromCookieHeader } from '../services/devAuth.js';
import { acceptInvitesForEmail } from '../services/invitations.service.js';

function attach(req, ctx) {
  req.currentUser = ctx.currentUser;
  req.memberships = ctx.memberships;
  req.isInternal = ctx.isInternal;
  req.isManager = ctx.isManager;
  req.permissions = ctx.permissions;
  req.can = ctx.can;
}
/** The auth context `attach()` put on `req` — services take this, never req/res. */
export const ctxOf = (req) => ({
  currentUser: req.currentUser,
  memberships: req.memberships,
  isInternal: req.isInternal,
  isManager: req.isManager,
  permissions: req.permissions,
  can: req.can,
});


export async function requireUser(req, res, next) {
  try {
    // In-process call from WhatsApp / MCP, signed by the server itself (see services/internalApi.js).
    if (req.internalUserId) {
      const ictx = await loadContextByUserId(req.internalUserId);
      if (!ictx) return res.status(403).json({ error: 'Your account has no active membership.', code: 'NO_MEMBERSHIP' });
      attach(req, ictx);
      return next();
    }
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
    attach(req, ctx);
    next();
  } catch (e) {
    next(e);
  }
}

// Row-scope policy lives in rbac/scope.js; re-exported here so existing imports keep working.
export { isManager, canSeeOrg, orgScope, internalTeamIds, ticketScope, taskTeamScope, activityScope } from '../rbac/scope.js';
import { isManager } from '../rbac/scope.js';

export const requireManager = (req, res, next) =>
  isManager(req) ? next() : res.status(403).json({ error: 'Manager permission required' });
export const requireInternal = (req, res, next) =>
  req.isInternal ? next() : res.status(403).json({ error: 'Internal staff access required' });

/** RBAC gate: allow the request only if the user's role grants `permission`. */
export const requirePermission = (permission) => (req, res, next) =>
  req.can(permission) ? next() : res.status(403).json({ error: `You don't have permission to do this (${permission}).`, permission });
