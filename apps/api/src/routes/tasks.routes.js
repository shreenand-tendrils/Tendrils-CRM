import { Router } from 'express';
import { prisma } from '../db.js';
import { orgScope, requirePermission, canSeeOrg } from '../middleware/index.js';
import { canEditTask } from '../rbac/policies.js';
import {
  logActivity, notifyAssignment, resolveAssignees, assertAssignees, assertProjectInOrg, assertTicketInOrg, syncTicketFromTask,
} from '../services/index.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { taskCreate, taskUpdate } from '../validators/schemas.js';

const router = Router();
const userSelect = { id: true, name: true, email: true, image: true };
const include = {
  organization: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  ticket: { select: { id: true, key: true, title: true } },
  assignee: { select: userSelect },
  assignees: { include: { user: { select: userSelect } } },
};
const asRows = (ids) => ids.map((userId) => ({ userId }));
const link = (t) => `/?task=${t.id}`;

// Tasks are internal work items: clients get an empty list (so the shared workspace
// load still succeeds) and cannot create or edit them.
router.get('/tasks', async (req, res) => {
  if (!req.isInternal) return res.json([]);
  const mine = req.query.mine === 'true' ? { OR: [{ assigneeId: req.currentUser.id }, { assignees: { some: { userId: req.currentUser.id } } }] } : {};
  res.json(await prisma.task.findMany({ where: { ...orgScope(req), ...mine }, orderBy: [{ position: 'asc' }, { updatedAt: 'desc' }], take: 300, include }));
});

router.post('/tasks', requirePermission('task.create'), async (req, res) => {
  const { assigneeIds, assigneeId, ...data } = parseBody(taskCreate, req.body);
  let ids = resolveAssignees({ assigneeIds, assigneeId }) ?? [];
  const me = req.currentUser.id;
  if (!req.can('task.assign')) {
    if (ids.some((id) => id !== me)) throw new AppError("You don't have permission to assign tasks to others (task.assign).", 403);
    if (!ids.length) ids = [me]; // employees' own tasks default to themselves
  }
  if (!canSeeOrg(req, data.organizationId)) throw new AppError('Organization access denied', 403);
  await assertProjectInOrg(data.projectId, data.organizationId);
  await assertTicketInOrg(data.ticketId, data.organizationId);
  await assertAssignees(ids);

  const task = await prisma.task.create({
    data: { ...data, creatorId: req.currentUser.id, assigneeId: ids[0] ?? null, assignees: { create: asRows(ids) } },
  });
  await logActivity({
    actorId: req.currentUser.id, organizationId: task.organizationId, entityType: 'task', entityId: task.id,
    action: 'created', summary: `Created task ${task.title}`,
  });
  for (const userId of ids) await notifyAssignment({ userId, actor: req.currentUser, title: task.title, kind: 'task', href: link(task) });
  res.status(201).json(task);
});

router.patch('/tasks/:id', async (req, res) => {
  const old = await prisma.task.findUnique({ where: { id: req.params.id }, include: { assignees: true } });
  if (!old || !req.isInternal || !canSeeOrg(req, old.organizationId)) throw new AppError('Task not found', 404);
  if (!canEditTask(req, old)) throw new AppError("You can only edit tasks you created or are assigned to.", 403);
  const { assigneeIds, assigneeId, ...data } = parseBody(taskUpdate, req.body);
  const ids = resolveAssignees({ assigneeIds, assigneeId });
  if (ids && !req.can('task.assign')) throw new AppError("You don't have permission to change assignees (task.assign).", 403);
  if (ids) {
    await assertAssignees(ids);
    data.assigneeId = ids[0] ?? null;
    data.assignees = { deleteMany: {}, create: asRows(ids) };
  }

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: old.id }, data });
    if (data.status && data.status !== old.status) await syncTicketFromTask(tx, updated, { actor: req.currentUser });
    return updated;
  });
  await logActivity({
    actorId: req.currentUser.id, organizationId: task.organizationId, entityType: 'task', entityId: task.id,
    action: 'updated', summary: `Updated task ${task.title}`,
  });
  if (ids) {
    const before = new Set([old.assigneeId, ...old.assignees.map((a) => a.userId)].filter(Boolean));
    for (const userId of ids.filter((u) => !before.has(u))) await notifyAssignment({ userId, actor: req.currentUser, title: task.title, kind: 'task', href: link(task) });
  }
  res.json(task);
});
export default router;
