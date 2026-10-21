// Database-agnostic invitation rules (db is injected) so they can be unit-tested without PostgreSQL.
import { AppError } from '../errors/AppError.js';
import { roleFitsOrgType } from '../rbac/policies.js';

export const INVITE_TTL_DAYS = Number(process.env.INVITE_EXPIRY_DAYS || 7);
export const normalizeEmail = (e = '') => String(e).trim().toLowerCase();
export const inviteExpiry = (from = Date.now()) => new Date(from + INVITE_TTL_DAYS * 86400000);
export const isInviteUsable = (inv, now = Date.now()) => inv.status === 'PENDING' && new Date(inv.expiresAt).getTime() > now;

/** Teams must be INTERNAL-org teams, and only staff memberships can have teams. */
export async function assertTeamsFor(db, orgType, teamIds = []) {
  const ids = [...new Set(teamIds)];
  if (!ids.length) return ids;
  if (orgType !== 'INTERNAL') throw new AppError('Only internal (staff) members can be placed in teams', 400, 'TEAMS_INTERNAL_ONLY');
  const found = await db.team.count({ where: { id: { in: ids }, isActive: true, organization: { type: 'INTERNAL' } } });
  if (found !== ids.length) throw new AppError('One or more teams were not found', 400, 'INVALID_TEAM');
  return ids;
}

/** Replace a membership's teams (many teams per member). Returns the new team ids. */
export async function setMembershipTeams(db, membershipId, teamIds) {
  await db.teamMember.deleteMany({ where: { membershipId } });
  if (teamIds.length) await db.teamMember.createMany({ data: teamIds.map((teamId) => ({ teamId, membershipId })), skipDuplicates: true });
  return teamIds;
}

/** Create/re-activate the user + membership (+ teams). Used by manual provisioning and by invite acceptance. */
export async function grantMembership(db, { email, name, organizationId, role, teamIds = [] }) {
  const user = await db.user.upsert({ where: { email }, update: {}, create: { email, name: name || null } });
  const membership = await db.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId } },
    update: { role, isActive: true }, create: { userId: user.id, organizationId, role },
  });
  if (teamIds.length) await db.teamMember.createMany({ data: teamIds.map((teamId) => ({ teamId, membershipId: membership.id })), skipDuplicates: true });
  return { user, membership };
}

/**
 * Called after Google has verified the email. Turns every usable invitation for that email into a membership.
 * Returns how many were accepted. Expired / revoked invitations are ignored.
 */
export async function acceptInvitesForEmail(db, emailRaw, name) {
  const email = normalizeEmail(emailRaw);
  if (!email) return 0;
  const pending = await db.invitation.findMany({ where: { email, status: 'PENDING', expiresAt: { gt: new Date() } }, include: { organization: true } });
  let accepted = 0;
  for (const inv of pending) {
    if (!roleFitsOrgType(inv.role, inv.organization.type) || !inv.organization.isActive) continue;
    await db.$transaction(async (tx) => {
      const teamIds = inv.organization.type === 'INTERNAL' ? (await tx.team.findMany({ where: { id: { in: inv.teamIds }, organization: { type: 'INTERNAL' } }, select: { id: true } })).map((t) => t.id) : [];
      await grantMembership(tx, { email, name, organizationId: inv.organizationId, role: inv.role, teamIds });
      await tx.invitation.update({ where: { id: inv.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    });
    accepted++;
  }
  return accepted;
}

/** Sign-in gate: an existing active member, or someone holding a usable invitation. */
export async function canSignIn(db, emailRaw) {
  const email = normalizeEmail(emailRaw);
  if (!email) return false;
  const [member, invite] = await Promise.all([
    db.membership.findFirst({ where: { isActive: true, organization: { isActive: true }, user: { email } }, select: { id: true } }),
    db.invitation.findFirst({ where: { email, status: 'PENDING', expiresAt: { gt: new Date() } }, select: { id: true } }),
  ]);
  return Boolean(member || invite);
}
