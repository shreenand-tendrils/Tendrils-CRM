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
    prisma.ticket.count({ where: { ...ticketScope(req), status: { not: 'CLOSED' } } }),
    taskCount(),
    taskCount({ dueDate: { lt: new Date() } }),
    prisma.notification.count({ where: { userId: req.currentUser.id, readAt: null } }),
    workspaceRepository.findRecentActivity(req, 8),
  ]);
  res.json({ metrics: { projects, tickets, tasks, overdue, unread }, recent });
});
// Ticket and task analytics for a date range, inside the caller's own scope (clients see their own tickets only).
const DAY = 86400000;
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const parseDay = (v, fallback) => { const d = v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`) : null; return d && !Number.isNaN(d.getTime()) ? d : fallback; };
router.get('/analytics', async (req, res) => {
  const now = new Date();
  const to0 = parseDay(req.query.to, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
  const from = parseDay(req.query.from, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)));
  const to = new Date(to0.getTime() + DAY); // inclusive end day
  if (from >= to || to - from > 800 * DAY) return res.status(400).json({ error: 'Pick a valid date range (up to about 2 years).' });
  // ?scope=mine narrows everything to the caller's own work (tickets they raised or hold, tasks assigned to them).
  const me = req.currentUser.id;
  const mine = req.query.scope === 'mine';
  const base = ticketScope(req);
  const scope = mine ? { AND: [base, { OR: req.isInternal ? [{ assigneeId: me }, { requesterId: me }] : [{ requesterId: me }] }] } : base;
  const [byStatus, inRange, openRows] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    prisma.ticket.findMany({ where: { AND: [scope, { OR: [{ createdAt: { gte: from, lt: to } }, { closedAt: { gte: from, lt: to } }] }] }, select: { createdAt: true, closedAt: true }, take: 10000 }),
    prisma.ticket.findMany({ where: { AND: [scope, { status: { not: 'CLOSED' } }] }, select: { createdAt: true, dueDate: true }, take: 10000 }),
  ]);
  const months = new Map();
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d < to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.set(monthKey(d), { month: monthKey(d), opened: 0, closed: 0 });
  let opened = 0, closed = 0, closeDays = 0;
  for (const t of inRange) {
    if (t.createdAt >= from && t.createdAt < to) { opened += 1; months.get(monthKey(t.createdAt)).opened += 1; }
    if (t.closedAt && t.closedAt >= from && t.closedAt < to) { closed += 1; closeDays += (t.closedAt - t.createdAt) / DAY; months.get(monthKey(t.closedAt)).closed += 1; }
  }
  const status = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]));
  const out = {
    scope: mine ? 'mine' : 'all',
    range: { from: from.toISOString().slice(0, 10), to: to0.toISOString().slice(0, 10) },
    status: { OPEN: status.OPEN || 0, REVIEW_TEST: status.REVIEW_TEST || 0, REVIEW_HELP: status.REVIEW_HELP || 0, CLOSED: status.CLOSED || 0 },
    tickets: {
      opened, closed, avgDaysToClose: closed ? Math.round((closeDays / closed) * 10) / 10 : null,
      avgDaysOpen: openRows.length ? Math.round((openRows.reduce((n, t) => n + (now - t.createdAt) / DAY, 0) / openRows.length) * 10) / 10 : null,
      overdue: openRows.filter((t) => t.dueDate && t.dueDate < now).length,
    },
    months: [...months.values()],
  };
  if (req.isInternal) {
    const tScope = { AND: [orgScope(req), taskTeamScope(req), ...(mine ? [{ OR: [{ assigneeId: me }, { assignees: { some: { userId: me } } }] }] : [])] };
    const [tOpened, tDone, tOpen, tOverdue] = await Promise.all([
      prisma.task.count({ where: { AND: [tScope, { createdAt: { gte: from, lt: to } }] } }),
      prisma.task.findMany({ where: { AND: [tScope, { completedAt: { gte: from, lt: to } }] }, select: { createdAt: true, completedAt: true }, take: 10000 }),
      prisma.task.count({ where: { AND: [tScope, { status: { not: 'DONE' } }] } }),
      prisma.task.count({ where: { AND: [tScope, { status: { not: 'DONE' }, dueDate: { lt: now } }] } }),
    ]);
    out.tasks = { opened: tOpened, done: tDone.length, open: tOpen, overdue: tOverdue, avgDaysToDone: tDone.length ? Math.round((tDone.reduce((n, t) => n + (t.completedAt - t.createdAt) / DAY, 0) / tDone.length) * 10) / 10 : null };
  }
  res.json(out);
});
export default router;
