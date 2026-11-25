import { Router } from 'express';
import { prisma } from '../db.js';
import { requirePermission, taskTeamScope } from '../middleware/index.js';
import { AppError } from '../errors/AppError.js';
import { safeActivityScope } from '../repositories/workspace.repository.js';
import { logActivity } from '../services/activity.js';

// Admin console API: managers/admins of the internal organization only.
const router = Router();
router.use('/admin', requirePermission('admin.view'));

const userSelect = { id: true, name: true, email: true, image: true };
const parseDay = (v) => {
  const s = v ? String(v) : new Date().toISOString().slice(0, 10);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime())) throw new AppError('date must be YYYY-MM-DD', 400);
  return { s, d };
};


// Display names are global user data. Only a Platform Admin may change another person's name.
router.patch('/admin/users/:id/name', async (req, res) => {
  if (!req.can('member.grant_admin')) throw new AppError('Only a Platform admin can rename people.', 403);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2 || name.length > 120) throw new AppError('Name must be between 2 and 120 characters.', 400);
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
  if (!target) throw new AppError('User not found.', 404);
  const updated = await prisma.user.update({ where: { id: target.id }, data: { name }, select: userSelect });
  await logActivity({ actorId: req.currentUser.id, organizationId: req.memberships?.find((m) => m.organization?.type === 'INTERNAL')?.organizationId, entityType: 'user', entityId: target.id, action: 'updated', summary: `Renamed ${target.email || target.id} to ${name}` });
  res.json(updated);
});

router.get('/admin/overview', async (req, res) => {
  const { s, d } = parseDay(req.query.date);
  const [staff, updates, open, recent] = await Promise.all([
    prisma.user.findMany({
      where: { memberships: { some: { isActive: true, organization: { type: 'INTERNAL' } } } },
      select: { ...userSelect, memberships: { where: { isActive: true, organization: { type: 'INTERNAL' } }, select: { role: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.dailyUpdate.findMany({ where: { date: d }, include: { user: { select: userSelect } }, orderBy: { updatedAt: 'desc' } }),
    prisma.taskAssignee.findMany({ where: { task: { AND: [taskTeamScope(req), { status: { not: 'DONE' } }] } }, select: { userId: true, task: { select: { dueDate: true, status: true } } } }),
    prisma.activityLog.findMany({ where: await safeActivityScope(req), orderBy: { createdAt: 'desc' }, take: 20, include: { actor: { select: { name: true, email: true } } } }),
  ]);

  const submitted = new Set(updates.map((u) => u.userId));
  const now = new Date();
  const load = new Map(staff.map((u) => [u.id, { open: 0, overdue: 0, blocked: 0 }]));
  for (const { userId, task } of open) {
    const l = load.get(userId);
    if (!l) continue;
    l.open++;
    if (task.status === 'BLOCKED') l.blocked++;
    if (task.dueDate && task.dueDate < now) l.overdue++;
  }
  res.json({
    date: s,
    stats: { staff: staff.length, submitted: updates.length, missing: staff.length - submitted.size },
    updates,
    missing: staff.filter((u) => !submitted.has(u.id)).map(({ memberships, ...u }) => ({ ...u, role: memberships[0]?.role })),
    workload: staff.map(({ memberships, ...u }) => ({ ...u, role: memberships[0]?.role, ...load.get(u.id) })),
    recent,
  });
});

router.get('/admin/updates', async (req, res) => {
  const from = parseDay(req.query.from || new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)).d;
  const to = parseDay(req.query.to).d;
  res.json(
    await prisma.dailyUpdate.findMany({
      where: { date: { gte: from, lte: to }, ...(req.query.userId ? { userId: String(req.query.userId) } : {}) },
      include: { user: { select: userSelect } },
      orderBy: [{ date: 'desc' }, { updatedAt: 'desc' }],
      take: 300,
    })
  );
});
export default router;
