import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/index.js';
import { logActivity } from '../services/index.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { teamMembersSet } from '../validators/schemas.js';

const router = Router();
const personSelect = { id: true, name: true, email: true, image: true };
const slugOf = (name) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'team';
const teamBody = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  clientVisible: z.boolean().optional(),
});

// Teams are internal structures. Staff see the active ones; the Platform admin can also list archived ones (?all=1).
router.get('/teams', async (req, res) => {
  if (!req.can('team.view')) return res.json([]);
  const all = req.query.all === '1' && req.can('team.manage');
  res.json(await prisma.team.findMany({
    where: { organization: { type: 'INTERNAL' }, ...(all ? {} : { isActive: true }) }, orderBy: { name: 'asc' },
    include: { _count: { select: { members: true } }, members: { where: { membership: { isActive: true } }, include: { membership: { select: { id: true, role: true, user: { select: personSelect } } } } } },
  }));
});

// What a client may choose from when raising a ticket or requesting a project: names only, no people.
router.get('/teams/requestable', async (_req, res) => {
  res.json(await prisma.team.findMany({ where: { isActive: true, clientVisible: true, organization: { type: 'INTERNAL' } }, orderBy: { name: 'asc' }, select: { id: true, name: true, description: true } }));
});

// Staff who can be put in a team (Platform admin only).
router.get('/teams/candidates', requirePermission('team.manage'), async (_req, res) => {
  const rows = await prisma.membership.findMany({ where: { isActive: true, organization: { type: 'INTERNAL' } }, select: { id: true, role: true, user: { select: personSelect } }, orderBy: { createdAt: 'asc' } });
  res.json(rows.map((m) => ({ id: m.id, name: m.user.name, email: m.user.email, role: m.role })));
});

router.post('/teams', requirePermission('team.manage'), async (req, res) => {
  const data = parseBody(teamBody, req.body);
  const org = await prisma.organization.findFirst({ where: { type: 'INTERNAL' }, orderBy: { createdAt: 'asc' } });
  if (!org) throw new AppError('No internal organization found', 400);
  let slug = slugOf(data.name);
  if (await prisma.team.findFirst({ where: { organizationId: org.id, slug } })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  if (await prisma.team.findFirst({ where: { organizationId: org.id, name: { equals: data.name, mode: 'insensitive' }, isActive: true } })) throw new AppError('A team with this name already exists.', 409);
  const team = await prisma.team.create({ data: { ...data, slug, organizationId: org.id } });
  await logActivity({ actorId: req.currentUser.id, organizationId: org.id, entityType: 'team', entityId: team.id, action: 'created', summary: `Created team ${team.name}` });
  res.status(201).json(team);
});

async function loadTeam(req) {
  const team = await prisma.team.findFirst({ where: { id: req.params.id, organization: { type: 'INTERNAL' } } });
  if (!team) throw new AppError('Team not found', 404);
  return team;
}

router.patch('/teams/:id', requirePermission('team.manage'), async (req, res) => {
  const team = await loadTeam(req);
  const data = parseBody(teamBody.partial().extend({ isActive: z.boolean().optional() }), req.body);
  if (data.name && data.name.toLowerCase() !== team.name.toLowerCase() && await prisma.team.findFirst({ where: { organizationId: team.organizationId, id: { not: team.id }, name: { equals: data.name, mode: 'insensitive' }, isActive: true } })) throw new AppError('A team with this name already exists.', 409);
  const updated = await prisma.team.update({ where: { id: team.id }, data: { ...data, ...(data.description === '' ? { description: null } : {}) } });
  await logActivity({ actorId: req.currentUser.id, organizationId: team.organizationId, entityType: 'team', entityId: team.id, action: 'updated', summary: `Updated team ${updated.name}${data.isActive === false ? ' (archived)' : data.isActive === true ? ' (restored)' : ''}` });
  res.json(updated);
});

// Remove: a team that never held any work is deleted; a team with history is archived so old tickets and tasks keep their trail.
router.delete('/teams/:id', requirePermission('team.manage'), async (req, res) => {
  const team = await loadTeam(req);
  const used = (await prisma.ticketTeamAccess.count({ where: { teamId: team.id } })) + (await prisma.taskTeamAccess.count({ where: { teamId: team.id } })) + (await prisma.task.count({ where: { teamId: team.id } })) + (await prisma.projectTeam.count({ where: { teamId: team.id } }));
  if (used) {
    await prisma.team.update({ where: { id: team.id }, data: { isActive: false } });
    await logActivity({ actorId: req.currentUser.id, organizationId: team.organizationId, entityType: 'team', entityId: team.id, action: 'updated', summary: `Archived team ${team.name}` });
    return res.json({ ok: true, archived: true });
  }
  await prisma.team.delete({ where: { id: team.id } });
  await logActivity({ actorId: req.currentUser.id, organizationId: team.organizationId, entityType: 'team', entityId: team.id, action: 'deleted', summary: `Deleted team ${team.name}` });
  res.json({ ok: true, archived: false });
});

// Replace a team's roster (staff memberships only). Platform admin only.
router.put('/teams/:id/members', requirePermission('team.manage'), async (req, res) => {
  const team = await loadTeam(req);
  const { membershipIds } = parseBody(teamMembersSet, req.body);
  const ids = [...new Set(membershipIds)];
  const ok = await prisma.membership.count({ where: { id: { in: ids }, isActive: true, organization: { type: 'INTERNAL' } } });
  if (ok !== ids.length) throw new AppError('Only active staff members can join a team', 400, 'INVALID_MEMBER');
  await prisma.$transaction([
    prisma.teamMember.deleteMany({ where: { teamId: team.id } }),
    prisma.teamMember.createMany({ data: ids.map((membershipId) => ({ teamId: team.id, membershipId })), skipDuplicates: true }),
  ]);
  await logActivity({ actorId: req.currentUser.id, organizationId: team.organizationId, entityType: 'team', entityId: team.id, action: 'updated', summary: `Updated roster of ${team.name} (${ids.length} members)` });
  res.json({ ok: true, count: ids.length });
});
export default router;
