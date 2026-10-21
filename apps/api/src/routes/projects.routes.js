import { Router } from 'express';
import { prisma } from '../db.js';
import { orgScope, requirePermission, canSeeOrg } from '../middleware/index.js';
import { logActivity, notifyUser, notifyPeople, findTeamManagers, findTriagers, assertAssignees } from '../services/index.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { projectCreate, projectMembersSet, projectRequest } from '../validators/schemas.js';

// Teams must be active internal teams (clients: also visible to clients).
async function validTeams(ids = [], { forClient = false } = {}) {
  const list = [...new Set(ids)];
  if (!list.length) return list;
  const n = await prisma.team.count({ where: { id: { in: list }, isActive: true, ...(forClient ? { clientVisible: true } : {}), organization: { type: 'INTERNAL' } } });
  if (n !== list.length) throw new AppError('Pick teams from the list offered.', 400, 'INVALID_TEAM');
  return list;
}

const router = Router();
const userSelect = { id: true, name: true, email: true, image: true };

router.get('/projects', async (req, res) =>
  res.json(
    await prisma.project.findMany({
      where: orgScope(req),
      orderBy: { updatedAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true } },
        teams: { select: { teamId: true, team: { select: { id: true, name: true } } } },
        _count: { select: { tickets: true, tasks: true } },
        // Team composition and chat are staff-only; clients never receive them.
        ...(req.isInternal ? { members: { include: { user: { select: userSelect } } }, chatRoom: { select: { id: true } } } : {}),
      },
    })
  )
);

router.post('/projects', requirePermission('project.create'), async (req, res) => {
  const { memberIds = [], teamIds = [], ...data } = parseBody(projectCreate, req.body);
  if (!canSeeOrg(req, data.organizationId)) throw new AppError('Organization access denied', 403);
  const teams = await validTeams(teamIds);
  const others = [...new Set(memberIds)].filter((u) => u !== req.currentUser.id);
  await assertAssignees(others);

  const project = await prisma.project.create({
    data: {
      ...data,
      ownerId: req.currentUser.id,
      teams: { create: teams.map((teamId) => ({ teamId })) },
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

// A client asks for a project and chooses which team(s) should do it. Those teams' managers are added and told;
// with no team chosen, every manager is told. Staff then plan it like any other project.
router.post('/projects/request', requirePermission('project.request'), async (req, res) => {
  const { teamIds = [], ...data } = parseBody(projectRequest, req.body);
  if (!canSeeOrg(req, data.organizationId)) throw new AppError('Organization access denied', 403);
  const teams = await validTeams(teamIds, { forClient: true });
  const managers = teams.length ? await findTeamManagers(teams) : [];
  const project = await prisma.project.create({
    data: {
      ...data, status: 'PLANNING', requestedByClient: true,
      teams: { create: teams.map((teamId) => ({ teamId })) },
      members: { create: managers.map((m) => ({ userId: m.id })) },
      chatRoom: { create: { name: data.name, type: 'PROJECT' } },
    },
    include: { organization: { select: { name: true } } },
  });
  await logActivity({ actorId: req.currentUser.id, organizationId: project.organizationId, entityType: 'project', entityId: project.id, action: 'created', summary: `Project requested: ${project.name}` });
  const audience = managers.length ? managers : await findTriagers();
  await notifyPeople({ userIds: audience.map((u) => u.id), actorId: req.currentUser.id, type: 'ASSIGNMENT', title: `Project request: ${project.name} (${project.organization.name})`, body: `${req.currentUser.name || req.currentUser.email} asked for this project. Open Projects to plan it.`, href: '/projects' });
  res.status(201).json(project);
});

// Replace the project team. Allowed for managers and the project lead.
router.put('/projects/:id/members', requirePermission('user.list'), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: { members: true } });
  if (!project || !canSeeOrg(req, project.organizationId)) throw new AppError('Project not found', 404);
  const isLead = project.members.some((m) => m.userId === req.currentUser.id && m.role === 'LEAD');
  if (!req.can('project.manage_team') && !isLead) throw new AppError('Only a manager or the project lead can change the team', 403);

  const { memberIds, leadId, teamIds } = parseBody(projectMembersSet, req.body);
  const newTeams = teamIds === undefined ? null : await validTeams(teamIds);
  const ids = [...new Set(memberIds)];
  if (!ids.length) throw new AppError('A project needs at least one member', 400);
  await assertAssignees(ids);
  const lead = ids.includes(leadId) ? leadId : project.members.find((m) => m.role === 'LEAD' && ids.includes(m.userId))?.userId ?? ids[0];

  await prisma.$transaction([
    prisma.projectMember.deleteMany({ where: { projectId: project.id } }),
    prisma.projectMember.createMany({ data: ids.map((userId) => ({ projectId: project.id, userId, role: userId === lead ? 'LEAD' : 'MEMBER' })) }),
    ...(newTeams ? [prisma.projectTeam.deleteMany({ where: { projectId: project.id } }), prisma.projectTeam.createMany({ data: newTeams.map((teamId) => ({ projectId: project.id, teamId })) })] : []),
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
