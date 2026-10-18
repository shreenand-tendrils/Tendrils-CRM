import { Router } from 'express';
import { prisma } from '../db.js';
import { orgScope, requirePermission, canSeeOrg } from '../middleware/index.js';
import { logActivity, notifyUser, assertAssignees } from '../services/index.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { projectCreate, projectMembersSet } from '../validators/schemas.js';

const router = Router();
const userSelect = { id: true, name: true, email: true, image: true };

router.get('/projects', async (req, res) =>
  res.json(
    await prisma.project.findMany({
      where: orgScope(req),
      orderBy: { updatedAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { tickets: true, tasks: true } },
        // Team composition and chat are staff-only; clients never receive them.
        ...(req.isInternal ? { members: { include: { user: { select: userSelect } } }, chatRoom: { select: { id: true } } } : {}),
      },
    })
  )
);

router.post('/projects', requirePermission('project.create'), async (req, res) => {
  const { memberIds = [], ...data } = parseBody(projectCreate, req.body);
  if (!canSeeOrg(req, data.organizationId)) throw new AppError('Organization access denied', 403);
  const others = [...new Set(memberIds)].filter((u) => u !== req.currentUser.id);
  await assertAssignees(others);

  const project = await prisma.project.create({
    data: {
      ...data,
      ownerId: req.currentUser.id,
      members: { create: [{ userId: req.currentUser.id, role: 'LEAD' }, ...others.map((userId) => ({ userId }))] },
      chatRoom: { create: { name: data.name, type: 'PROJECT' } },
    },
  });
  await logActivity({
    actorId: req.currentUser.id, organizationId: project.organizationId, entityType: 'project', entityId: project.id,
    action: 'created', summary: `Created project ${project.name}`,
  });
  for (const userId of others) {
    await notifyUser({ userId, type: 'ASSIGNMENT', title: `Added to project: ${project.name}`, body: `${req.currentUser.name || req.currentUser.email} added you to ${project.name}`, href: '/projects' });
  }
  res.status(201).json(project);
});

// Replace the project team. Allowed for managers and the project lead.
router.put('/projects/:id/members', requirePermission('user.list'), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: { members: true } });
  if (!project || !canSeeOrg(req, project.organizationId)) throw new AppError('Project not found', 404);
  const isLead = project.members.some((m) => m.userId === req.currentUser.id && m.role === 'LEAD');
  if (!req.can('project.manage_team') && !isLead) throw new AppError('Only a manager or the project lead can change the team', 403);

  const { memberIds, leadId } = parseBody(projectMembersSet, req.body);
  const ids = [...new Set(memberIds)];
  if (!ids.length) throw new AppError('A project needs at least one member', 400);
  await assertAssignees(ids);
  const lead = ids.includes(leadId) ? leadId : project.members.find((m) => m.role === 'LEAD' && ids.includes(m.userId))?.userId ?? ids[0];

  await prisma.$transaction([
    prisma.projectMember.deleteMany({ where: { projectId: project.id } }),
    prisma.projectMember.createMany({ data: ids.map((userId) => ({ projectId: project.id, userId, role: userId === lead ? 'LEAD' : 'MEMBER' })) }),
  ]);
  await logActivity({
    actorId: req.currentUser.id, organizationId: project.organizationId, entityType: 'project', entityId: project.id,
    action: 'updated', summary: `Updated team of ${project.name} (${ids.length} members)`,
  });
  const before = new Set(project.members.map((m) => m.userId));
  for (const userId of ids.filter((u) => !before.has(u) && u !== req.currentUser.id)) {
    await notifyUser({ userId, type: 'ASSIGNMENT', title: `Added to project: ${project.name}`, body: `${req.currentUser.name || req.currentUser.email} added you to ${project.name}`, href: '/projects' });
  }
  res.json(await prisma.projectMember.findMany({ where: { projectId: project.id }, include: { user: { select: userSelect } } }));
});
export default router;
