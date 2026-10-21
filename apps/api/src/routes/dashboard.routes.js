import { Router } from 'express';
import { prisma } from '../db.js';
import { orgScope, ticketScope, taskTeamScope } from '../middleware/index.js';
import { workspaceRepository } from '../repositories/workspace.repository.js';

const router = Router();
router.get('/dashboard', async (req, res) => {
  const org = orgScope(req);
  const taskCount = (extra = {}) => (req.isInternal ? prisma.task.count({ where: { AND: [org, taskTeamScope(req), { status: { not: 'DONE' } }, extra] } }) : 0); // tasks are internal-only
  const [projects, tickets, tasks, overdue, unread, recent] = await Promise.all([
    prisma.project.count({ where: { ...org, status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] } } }),
    prisma.ticket.count({ where: { ...ticketScope(req), status: { notIn: ['CLOSED', 'RESOLVED'] } } }),
    taskCount(),
    taskCount({ dueDate: { lt: new Date() } }),
    prisma.notification.count({ where: { userId: req.currentUser.id, readAt: null } }),
    workspaceRepository.findRecentActivity(req, 8),
  ]);
  res.json({ metrics: { projects, tickets, tasks, overdue, unread }, recent });
});
export default router;
