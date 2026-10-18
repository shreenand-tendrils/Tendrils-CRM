import { Router } from 'express';
import { prisma } from '../db.js';
import { orgScope, ticketScope, activityScope } from '../middleware/index.js';

const router = Router();
router.get('/dashboard', async (req, res) => {
  const org = orgScope(req);
  const taskCount = (extra = {}) => (req.isInternal ? prisma.task.count({ where: { ...org, status: { not: 'DONE' }, ...extra } }) : 0); // tasks are internal-only
  const [projects, tickets, tasks, overdue, unread, recent] = await Promise.all([
    prisma.project.count({ where: { ...org, status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] } } }),
    prisma.ticket.count({ where: { ...ticketScope(req), status: { notIn: ['CLOSED', 'RESOLVED'] } } }),
    taskCount(),
    taskCount({ dueDate: { lt: new Date() } }),
    prisma.notification.count({ where: { userId: req.currentUser.id, readAt: null } }),
    prisma.activityLog.findMany({ where: activityScope(req), orderBy: { createdAt: 'desc' }, take: 8, include: { actor: { select: { name: true, email: true } } } }),
  ]);
  res.json({ metrics: { projects, tickets, tasks, overdue, unread }, recent });
});
export default router;
