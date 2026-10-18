import { Router } from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/index.js';
import { logActivity, grantMembership, assertTeamsFor, setMembershipTeams, inviteExpiry, sendInviteEmail, sendAccessGrantedEmail, fireAndLog } from '../services/index.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { memberInvite, memberUpdate, invitationCreate, memberTeamsSet } from '../validators/schemas.js';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABELS } from '../rbac/permissions.js';
import { checkMemberChange, checkGrant, roleFitsOrgType } from '../rbac/policies.js';

// People & access (admin console). Its audit events use entityType 'access': visible to admins only, never to staff or clients. Two ways in: manual provisioning (POST /admin/members) and email
// invitations (POST /admin/invitations). Either way, sign-in is Google and access is decided by membership.
const router = Router();
const guard = requirePermission('member.manage');
const RESEND_COOLDOWN_MS = 60 * 1000;
const include = {
  user: { select: { id: true, name: true, email: true, image: true } },
  organization: { select: { id: true, name: true, type: true } },
  teamMemberships: { include: { team: { select: { id: true, name: true } } } },
};
const present = ({ teamMemberships, ...m }) => ({ ...m, memberType: m.organization.type === 'INTERNAL' ? 'internal' : 'client', teams: teamMemberships.map((t) => t.team) });
const invInclude = { organization: { select: { id: true, name: true, type: true } }, invitedBy: { select: { id: true, name: true, email: true } } };
const presentInv = (i) => ({ ...i, memberType: i.organization.type === 'INTERNAL' ? 'internal' : 'client', expired: i.status === 'PENDING' && i.expiresAt < new Date() });

router.get('/admin/rbac', (_req, res) =>
  res.json({
    permissions: Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label })),
    roles: Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({ role, label: ROLE_LABELS[role], permissions })),
  })
);

router.get('/admin/members', guard, async (_req, res) =>
  res.json((await prisma.membership.findMany({ include, orderBy: [{ organization: { type: 'asc' } }, { user: { name: 'asc' } }] })).map(present))
);

const otherActiveAdmins = (exceptUserId) =>
  prisma.membership.count({ where: { role: 'PLATFORM_ADMIN', isActive: true, userId: { not: exceptUserId }, organization: { type: 'INTERNAL' } } });

async function loadOrg(organizationId) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org || !org.isActive) throw new AppError('Organization not found', 404);
  return org;
}
function assertGrant(req, role, org) {
  const err = checkGrant({ actorCan: req.can, role, orgType: org.type });
  if (err) throw new AppError(err, err.startsWith('Only a Platform') ? 403 : 400);
}

// ---- Manual provisioning: the person can sign in with Google immediately.
router.post('/admin/members', guard, async (req, res) => {
  const { email, name, organizationId, role, teamIds = [], notify } = parseBody(memberInvite, req.body);
  const org = await loadOrg(organizationId);
  assertGrant(req, role, org);
  const teams = await assertTeamsFor(prisma, org.type, teamIds);

  const existing = await prisma.membership.findFirst({ where: { organizationId, user: { email } }, select: { id: true, role: true, isActive: true, userId: true } });
  if (existing?.userId === req.currentUser.id) throw new AppError("You can't change your own access. Ask another admin.", 403);
  if (existing?.role === 'PLATFORM_ADMIN' && !req.can('member.grant_admin')) throw new AppError('Only a Platform admin can change a Platform admin.', 403);

  const { membership } = await prisma.$transaction(async (tx) => {
    const g = await grantMembership(tx, { email, name, organizationId, role });
    await tx.invitation.updateMany({ where: { email, organizationId, status: 'PENDING' }, data: { status: 'ACCEPTED', acceptedAt: new Date() } }); // supersedes an open invite
    await setMembershipTeams(tx, g.membership.id, teams);
    return g;
  });
  await logActivity({ actorId: req.currentUser.id, organizationId, entityType: 'access', entityId: organizationId, action: 'updated', summary: `Gave ${email} the ${ROLE_LABELS[role]} role in ${org.name}` });
  if (notify) fireAndLog(sendAccessGrantedEmail({ to: email, name, orgName: org.name, roleLabel: ROLE_LABELS[role] }));
  res.status(201).json(present(await prisma.membership.findUnique({ where: { id: membership.id }, include })));
});

router.patch('/admin/members/:id', guard, async (req, res) => {
  const target = await prisma.membership.findUnique({ where: { id: req.params.id }, include });
  if (!target) throw new AppError('Member not found', 404);
  const change = parseBody(memberUpdate, req.body);
  if (change.role && !roleFitsOrgType(change.role, target.organization.type)) throw new AppError('That role does not fit this workspace type', 400);
  const err = checkMemberChange({ actor: { id: req.currentUser.id, can: req.can }, target, change, otherActiveAdmins: await otherActiveAdmins(target.userId) });
  if (err) throw new AppError(err, err.startsWith('There must') ? 400 : 403);

  const m = await prisma.membership.update({ where: { id: target.id }, data: change, include });
  const what = [change.role && `role → ${ROLE_LABELS[change.role]}`, change.isActive !== undefined && (change.isActive ? 'reactivated' : 'deactivated')].filter(Boolean).join(', ');
  await logActivity({ actorId: req.currentUser.id, organizationId: m.organizationId, entityType: 'access', entityId: m.organizationId, action: 'updated', summary: `Changed access for ${m.user.email}: ${what}` });
  res.json(present(m));
});

// ---- Multiple teams per member.
router.put('/admin/members/:id/teams', guard, async (req, res) => {
  const target = await prisma.membership.findUnique({ where: { id: req.params.id }, include });
  if (!target) throw new AppError('Member not found', 404);
  const { teamIds } = parseBody(memberTeamsSet, req.body);
  const teams = await assertTeamsFor(prisma, target.organization.type, teamIds);
  await prisma.$transaction((tx) => setMembershipTeams(tx, target.id, teams));
  await logActivity({ actorId: req.currentUser.id, organizationId: target.organizationId, entityType: 'access', entityId: target.organizationId, action: 'updated', summary: `Updated teams for ${target.user.email} (${teams.length})` });
  res.json(present(await prisma.membership.findUnique({ where: { id: target.id }, include })));
});

// ---- Email invitations.
router.get('/admin/invitations', guard, async (_req, res) =>
  res.json((await prisma.invitation.findMany({ where: { status: 'PENDING' }, include: invInclude, orderBy: { createdAt: 'desc' }, take: 200 })).map(presentInv))
);

router.post('/admin/invitations', guard, async (req, res) => {
  const { email, organizationId, role, teamIds = [] } = parseBody(invitationCreate, req.body);
  const org = await loadOrg(organizationId);
  assertGrant(req, role, org);
  const teams = await assertTeamsFor(prisma, org.type, teamIds);
  if (await prisma.membership.findFirst({ where: { organizationId, isActive: true, user: { email } }, select: { id: true } })) {
    throw new AppError('That person already has access to this workspace. Edit their role instead.', 409, 'ALREADY_MEMBER');
  }
  const data = { role, teamIds: teams, invitedById: req.currentUser.id, expiresAt: inviteExpiry(), lastSentAt: new Date() };
  const open = await prisma.invitation.findFirst({ where: { email, organizationId, status: 'PENDING' } });
  const inv = open
    ? await prisma.invitation.update({ where: { id: open.id }, data, include: invInclude }) // re-inviting refreshes the open one
    : await prisma.invitation.create({ data: { email, organizationId, ...data }, include: invInclude });
  fireAndLog(sendInviteEmail({ to: email, inviterName: req.currentUser.name, orgName: org.name, roleLabel: ROLE_LABELS[role], isClient: org.type === 'CLIENT', expiresAt: inv.expiresAt }));
  await logActivity({ actorId: req.currentUser.id, organizationId, entityType: 'access', entityId: organizationId, action: 'updated', summary: `Invited ${email} as ${ROLE_LABELS[role]} to ${org.name}` });
  res.status(201).json(presentInv(inv));
});

async function loadPending(id) {
  const inv = await prisma.invitation.findUnique({ where: { id }, include: invInclude });
  if (!inv || inv.status !== 'PENDING') throw new AppError('Invitation not found or already used', 404);
  return inv;
}

router.post('/admin/invitations/:id/resend', guard, async (req, res) => {
  const inv = await loadPending(req.params.id);
  if (Date.now() - inv.lastSentAt.getTime() < RESEND_COOLDOWN_MS) throw new AppError('Please wait a minute before resending.', 429, 'RESEND_COOLDOWN');
  const next = await prisma.invitation.update({ where: { id: inv.id }, data: { lastSentAt: new Date(), expiresAt: inviteExpiry() }, include: invInclude });
  fireAndLog(sendInviteEmail({ to: inv.email, inviterName: req.currentUser.name, orgName: inv.organization.name, roleLabel: ROLE_LABELS[inv.role], isClient: inv.organization.type === 'CLIENT', expiresAt: next.expiresAt }));
  res.json(presentInv(next));
});

router.delete('/admin/invitations/:id', guard, async (req, res) => {
  const inv = await loadPending(req.params.id);
  await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'REVOKED' } });
  await logActivity({ actorId: req.currentUser.id, organizationId: inv.organizationId, entityType: 'access', entityId: inv.organizationId, action: 'updated', summary: `Revoked invitation for ${inv.email}` });
  res.json({ ok: true });
});
export default router;
