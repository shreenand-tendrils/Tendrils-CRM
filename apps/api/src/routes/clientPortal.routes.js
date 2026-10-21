import { Router } from 'express';
import { prisma } from '../db.js';
import { orgScope, ticketScope, canSeeOrg } from '../middleware/index.js';
import { logActivity, notifyPeople, findClientUsers } from '../services/index.js';
import { canPostProjectUpdate } from '../rbac/policies.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { projectUpdateCreate } from '../validators/schemas.js';

// Client-facing progress: project updates (posted by staff) and the client dashboard summary.
const router = Router();
const authorSelect = { author: { select: { id: true, name: true, email: true } } };

async function loadProject(req) {
  const p = await prisma.project.findUnique({ where: { id: req.params.id }, include: { members: { select: { userId: true } } } });
  if (!p || !canSeeOrg(req, p.organizationId)) throw new AppError('Project not found', 404);
  return p;
}

router.get('/projects/:id/updates', async (req, res) => {
  const p = await loadProject(req);
  res.json(await prisma.projectUpdate.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, take: 50, include: authorSelect }));
});

router.post('/projects/:id/updates', async (req, res) => {
  const p = await loadProject(req);
  if (!canPostProjectUpdate(req, p)) throw new AppError('Only project members, team leads or managers can post project updates.', 403);
  const data = parseBody(projectUpdateCreate, req.body);
  const u = await prisma.projectUpdate.create({ data: { ...data, projectId: p.id, authorId: req.currentUser.id }, include: authorSelect });
  await logActivity({ actorId: req.currentUser.id, organizationId: p.organizationId, entityType: 'project', entityId: p.id, action: 'updated', summary: `Project update on ${p.name}: ${u.title}` });
  const clients = await findClientUsers(p.organizationId);
  await notifyPeople({ userIds: clients.map((c) => c.id), actorId: req.currentUser.id, type: 'SYSTEM', title: `Update on ${p.name}: ${u.title}`, body: u.body.slice(0, 300), href: '/' });
  res.status(201).json(u);
});

// Everything a client needs on one screen. Staff get the same shape for their own scope.
const STAGES = { received: ['OPEN', 'TRIAGED'], inProgress: ['IN_PROGRESS', 'BLOCKED', 'REVIEW'], awaitingYou: ['CLIENT_REVIEW'], done: ['RESOLVED', 'CLOSED'] };
router.get('/client/overview', async (req, res) => {
  const org = orgScope(req);
  const tScope = ticketScope(req);
  const [projects, grouped, awaiting, updates] = await Promise.all([
    prisma.project.findMany({
      where: { ...org, status: { not: 'ARCHIVED' } }, orderBy: { updatedAt: 'desc' }, take: 20,
      select: { id: true, name: true, status: true, dueDate: true, organization: { select: { id: true, name: true } }, updates: { take: 1, orderBy: { createdAt: 'desc' }, select: { title: true, createdAt: true } } },
    }),
    prisma.ticket.groupBy({ by: ['status'], where: tScope, _count: { _all: true } }),
    prisma.ticket.findMany({ where: { AND: [tScope, { status: 'CLIENT_REVIEW' }] }, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, key: true, title: true, updatedAt: true } }),
    prisma.projectUpdate.findMany({ where: { project: org }, orderBy: { createdAt: 'desc' }, take: 10, include: { ...authorSelect, project: { select: { id: true, name: true } } } }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const stages = Object.fromEntries(Object.entries(STAGES).map(([k, list]) => [k, list.reduce((n, st) => n + (byStatus[st] || 0), 0)]));
  res.json({ stages, awaiting, projects: projects.map(({ updates: u, ...p }) => ({ ...p, latestUpdate: u[0] || null })), updates });
});
export default router;
