import { Router } from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/index.js';
import { logActivity } from '../services/index.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { teamCreate, teamMembersSet } from '../validators/schemas.js';

const router = Router();
const personSelect = { id: true, name: true, email: true, image: true };
// Teams are internal-only structures; clients get no team data. A person can be in several teams.
router.get('/teams', async (req, res) => {
  if (!req.can('team.view')) return res.json([]);
  res.json(await prisma.team.findMany({
    where: { organization: { type: 'INTERNAL' } }, orderBy: { name: 'asc' },
    include: { _count: { select: { members: true } }, members: { where: { membership: { isActive: true } }, include: { membership: { select: { id: true, role: true, user: { select: personSelect } } } } } },
  }));
});
router.post('/teams', requirePermission('team.create'), async (req, res) => {
  const data = parseBody(teamCreate, req.body);
  const org = await prisma.organization.findUnique({ where: { id: data.organizationId } });
  if (!org || org.type !== 'INTERNAL') throw new AppError('Teams can only be created in the internal organization', 400);
  const team = await prisma.team.create({ data });
  await logActivity({ actorId: req.currentUser.id, organizationId: org.id, entityType: 'team', entityId: team.id, action: 'created', summary: `Created team ${team.name}` });
  res.status(201).json(team);
});
// Replace a team's roster (staff memberships only).
router.put('/teams/:id/members', requirePermission('member.manage'), async (req, res) => {
  const team = await prisma.team.findFirst({ where: { id: req.params.id, organization: { type: 'INTERNAL' } } });
  if (!team) throw new AppError('Team not found', 404);
  const { membershipIds } = parseBody(teamMembersSet, req.body);
  const ids = [...new Set(membershipIds)];
  const ok = await prisma.membership.count({ where: { id: { in: ids }, isActive: true, organization: { type: 'INTERNAL' } } });
  if (ok !== ids.length) throw new AppError('Only active staff members can join a team', 400, 'INVALID_MEMBER');
  await prisma.$transaction([
    prisma.teamMember.deleteMany({ where: { teamId: team.id } }),
    prisma.teamMember.createMany({ data: ids.map((membershipId) => ({ teamId: team.id, membershipId })), skipDuplicates: true }),
  ]);
  await logActivity({ actorId: req.currentUser.id, organizationId: team.organizationId, entityType: 'team', entityId: team.id, action: 'updated', summary: `Updated roster of ${team.name} (${ids.length})` });
  res.json({ ok: true, count: ids.length });
});
export default router;
