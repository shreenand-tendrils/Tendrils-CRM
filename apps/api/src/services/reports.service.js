import { prisma } from '../db.js';
import { isManager, internalTeamIds } from '../middleware/index.js';
import { AppError } from '../errors/AppError.js';

const DAY = 86400000;
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const avg = (xs) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const endOfDay = (d) => new Date(new Date(d).getTime() + DAY - 1);
const count = (rows, key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {});
const weekStart = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };

export function parseRange(q) {
  const to = q.to && !isNaN(new Date(q.to)) ? endOfDay(q.to) : endOfDay(new Date());
  let from = q.from && !isNaN(new Date(q.from)) ? new Date(q.from) : new Date(to.getTime() - 29 * DAY);
  from.setUTCHours(0, 0, 0, 0);
  if (from > to) throw new AppError('Start date is after end date.', 400);
  if (to - from > 366 * DAY) throw new AppError('Range is limited to 1 year.', 400);
  return { from, to };
}

const TASK_SEL = { id: true, status: true, priority: true, dueDate: true, completedAt: true, createdAt: true, assigneeId: true, assignees: { select: { userId: true } }, project: { select: { id: true, name: true } } };
const TICKET_SEL = { id: true, status: true, progress: true, priority: true, dueDate: true, closedAt: true, createdAt: true, assigneeId: true, requesterId: true, project: { select: { id: true, name: true } } };

/** Pure aggregation over already-scoped rows. */
export function summarize({ tasks, tickets }, { from, to }) {
  const now = new Date();
  const inR = (d) => d && d >= from && d <= to;
  const dueEnd = (d) => (d ? endOfDay(d) : null);
  const open = (t) => t.status !== 'DONE';

  const tOpen = tasks.filter(open);
  const tDone = tasks.filter((t) => t.status === 'DONE' && inR(t.completedAt));
  const tNew = tasks.filter((t) => inR(t.createdAt));
  const tScope = new Set([...tOpen, ...tDone, ...tNew]);
  const tOverdue = tOpen.filter((t) => t.dueDate && dueEnd(t.dueDate) < now);
  const tWithDue = tDone.filter((t) => t.dueDate);
  const tOnTime = tWithDue.filter((t) => t.completedAt <= dueEnd(t.dueDate));

  const kOpen = tickets.filter((t) => t.status !== 'CLOSED');
  const kClosed = tickets.filter((t) => t.status === 'CLOSED' && inR(t.closedAt));
  const kNew = tickets.filter((t) => inR(t.createdAt));
  const kScope = new Set([...kOpen, ...kClosed, ...kNew]);
  const kOverdue = kOpen.filter((t) => t.dueDate && dueEnd(t.dueDate) < now);
  const kWithDue = kClosed.filter((t) => t.dueDate);
  const kOnTime = kWithDue.filter((t) => t.closedAt <= dueEnd(t.dueDate));

  const age = (rows) => ({ d7: rows.filter((t) => now - t.createdAt > 7 * DAY).length, d14: rows.filter((t) => now - t.createdAt > 14 * DAY).length, d30: rows.filter((t) => now - t.createdAt > 30 * DAY).length });

  // weekly trend (created vs completed), capped to the last 14 weeks of the range
  const weeks = [];
  for (let w = weekStart(from); w <= to; w = new Date(w.getTime() + 7 * DAY)) weeks.push(w);
  const trend = weeks.slice(-14).map((w) => {
    const e = new Date(w.getTime() + 7 * DAY);
    const inW = (d) => d && d >= w && d < e;
    return {
      week: w.toISOString().slice(0, 10),
      created: tasks.filter((t) => inW(t.createdAt)).length + tickets.filter((t) => inW(t.createdAt)).length,
      completed: tasks.filter((t) => t.status === 'DONE' && inW(t.completedAt)).length + tickets.filter((t) => t.status === 'CLOSED' && inW(t.closedAt)).length,
    };
  });

  const proj = new Map();
  const bump = (p, k) => { if (!p) return; const x = proj.get(p.id) || { name: p.name, open: 0, done: 0, overdue: 0 }; x[k]++; proj.set(p.id, x); };
  tasks.forEach((t) => { if (open(t)) { bump(t.project, 'open'); if (tOverdue.includes(t)) bump(t.project, 'overdue'); } else if (inR(t.completedAt)) bump(t.project, 'done'); });
  tickets.forEach((t) => { if (t.status !== 'CLOSED') { bump(t.project, 'open'); if (kOverdue.includes(t)) bump(t.project, 'overdue'); } else if (inR(t.closedAt)) bump(t.project, 'done'); });

  return {
    tasks: {
      assignedOpen: tOpen.length, createdInPeriod: tNew.length, completedInPeriod: tDone.length, overdue: tOverdue.length, blocked: tOpen.filter((t) => t.status === 'BLOCKED').length,
      completionRate: pct(tDone.length, tScope.size), onTimeRate: pct(tOnTime.length, tWithDue.length), late: tWithDue.length - tOnTime.length,
      avgCycleDays: avg(tDone.map((t) => (t.completedAt - t.createdAt) / DAY)),
      avgDaysOverdue: avg(tOverdue.map((t) => (now - dueEnd(t.dueDate)) / DAY)),
      byStatus: count(tOpen, 'status'), byPriority: count(tOpen, 'priority'), aging: age(tOpen), total: tScope.size,
    },
    tickets: {
      open: kOpen.length, raisedInPeriod: kNew.length, closedInPeriod: kClosed.length, overdue: kOverdue.length,
      needInfo: kOpen.filter((t) => t.progress === 'NEED_MORE_INFO').length, inQa: kOpen.filter((t) => t.progress === 'QA').length,
      resolutionRate: pct(kClosed.length, kScope.size), slaRate: pct(kOnTime.length, kWithDue.length),
      avgResolutionDays: avg(kClosed.map((t) => (t.closedAt - t.createdAt) / DAY)),
      byStatus: count(tickets.filter((t) => kScope.has(t)), 'status'), byProgress: count(kOpen, 'progress'), byPriority: count(kOpen, 'priority'), aging: age(kOpen), total: kScope.size,
      avgResolutionByPriority: Object.fromEntries(['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((p) => [p, avg(kClosed.filter((t) => t.priority === p).map((t) => (t.closedAt - t.createdAt) / DAY))])),
    },
    trend,
    projects: [...proj.values()].sort((a, b) => b.open + b.done - (a.open + a.done)).slice(0, 8),
  };
}

const workingDays = (from, to) => { let n = 0; const end = Math.min(to, new Date()); for (let d = new Date(from); d <= end; d = new Date(d.getTime() + DAY)) { const g = d.getUTCDay(); if (g && g < 6) n++; } return n; };

async function people(userIds, { from, to }) {
  const range = { gte: from, lte: to };
  const [updates, comments, chats] = await Promise.all([
    prisma.dailyUpdate.findMany({ where: { userId: { in: userIds }, date: range }, select: { userId: true, date: true, blockers: true } }),
    prisma.comment.groupBy({ by: ['authorId'], where: { authorId: { in: userIds }, createdAt: range }, _count: true }),
    prisma.chatMessage.groupBy({ by: ['authorId'], where: { authorId: { in: userIds }, createdAt: range, deletedAt: null }, _count: true }),
  ]);
  const wd = workingDays(from, to) * userIds.length;
  const blk = (u) => u.blockers && !/^\s*(none|no|nil|n\/a|-+)?\s*$/i.test(u.blockers);
  return {
    updates: { posted: new Set(updates.map((u) => u.userId + u.date.toISOString().slice(0, 10))).size, expected: wd, rate: pct(new Set(updates.map((u) => u.userId + u.date.toISOString().slice(0, 10))).size, wd), withBlockers: updates.filter(blk).length },
    collab: { comments: comments.reduce((a, c) => a + c._count, 0), chatMessages: chats.reduce((a, c) => a + c._count, 0) },
    perUser: { comments: Object.fromEntries(comments.map((c) => [c.authorId, c._count])), chats: Object.fromEntries(chats.map((c) => [c.authorId, c._count])), updates: count(updates, 'userId') },
  };
}

const myTaskWhere = (id) => ({ OR: [{ assigneeId: id }, { assignees: { some: { userId: id } } }] });
const teamTaskWhere = (tid) => ({ OR: [{ teamId: tid }, { teamAccesses: { some: { teamId: tid } } }, { ticket: { is: { teamAccesses: { some: { teamId: tid } } } } }] });
const teamTicketWhere = (tid) => ({ OR: [{ teamId: tid }, { teamAccesses: { some: { teamId: tid } } }] });
const load = async (taskWhere, ticketWhere) => {
  const [tasks, tickets] = await Promise.all([
    taskWhere ? prisma.task.findMany({ where: taskWhere, select: TASK_SEL }) : [],
    ticketWhere ? prisma.ticket.findMany({ where: ticketWhere, select: TICKET_SEL }) : [],
  ]);
  return { tasks, tickets };
};
const kpi = (s) => ({ openTasks: s.tasks.assignedOpen, doneTasks: s.tasks.completedInPeriod, overdueTasks: s.tasks.overdue, onTimeRate: s.tasks.onTimeRate, openTickets: s.tickets.open, closedTickets: s.tickets.closedInPeriod, slaRate: s.tickets.slaRate });

/** Which reports this person may open. Everything else is rejected in buildReport. */
export async function reportOptions(req) {
  const staff = req.isInternal, admin = isManager(req);
  const scopes = [{ type: 'me', label: staff ? 'My report' : 'My requests' }];
  let users = [];
  if (staff) {
    const teams = await prisma.team.findMany({ where: { isActive: true, organization: { type: 'INTERNAL' }, ...(admin ? {} : { id: { in: internalTeamIds(req) } }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    if (admin) scopes.push({ type: 'all', label: 'Whole organisation' });
    teams.forEach((t) => scopes.push({ type: 'team', id: t.id, label: `Team: ${t.name}` }));
    if (admin) users = await prisma.user.findMany({ where: { memberships: { some: { isActive: true, organization: { type: 'INTERNAL' } } } }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } });
  }
  return { audience: staff ? 'staff' : 'client', admin, scopes, users };
}

export async function buildReport(req, q) {
  const range = parseRange(q);
  const uid = req.currentUser.id, staff = req.isInternal, admin = isManager(req);
  const type = q.scope || 'me';
  let label = 'My report', rows, memberIds = [uid], members = null, teams = null;

  if (type === 'me') {
    if (staff) rows = await load(myTaskWhere(uid), { OR: [{ assigneeId: uid }, { requesterId: uid }] });
    else { label = 'My requests'; rows = await load(null, { requesterId: uid, visibility: 'CLIENT', organizationId: { in: req.memberships.map((m) => m.organizationId) } }); }
  } else if (!staff) {
    throw new AppError('You can only view your own report.', 403);
  } else if (type === 'user') {
    if (!admin) throw new AppError('Only admins can view another person’s report.', 403);
    const u = await prisma.user.findUnique({ where: { id: String(q.id || '') }, select: { id: true, name: true, email: true } });
    if (!u) throw new AppError('Person not found.', 404);
    label = u.name || u.email; memberIds = [u.id];
    rows = await load(myTaskWhere(u.id), { OR: [{ assigneeId: u.id }, { requesterId: u.id }] });
  } else if (type === 'team') {
    const tid = String(q.id || '');
    if (!admin && !internalTeamIds(req).includes(tid)) throw new AppError('You can only view your own team’s report.', 403);
    const team = await prisma.team.findFirst({ where: { id: tid, organization: { type: 'INTERNAL' } }, include: { members: { where: { membership: { isActive: true } }, select: { membership: { select: { user: { select: { id: true, name: true, email: true } } } } } } } });
    if (!team) throw new AppError('Team not found.', 404);
    label = `Team: ${team.name}`;
    const users = team.members.map((m) => m.membership.user);
    memberIds = users.map((u) => u.id);
    rows = await load(teamTaskWhere(tid), teamTicketWhere(tid));
    if (admin) members = users.map((u) => ({ id: u.id, name: u.name || u.email }));
  } else if (type === 'all') {
    if (!admin) throw new AppError('Only admins can view the organisation report.', 403);
    label = 'Whole organisation';
    rows = await load({ organization: { type: 'INTERNAL' } }, { organization: { type: 'INTERNAL' } });
    const us = await prisma.user.findMany({ where: { memberships: { some: { isActive: true, organization: { type: 'INTERNAL' } } } }, select: { id: true, name: true, email: true } });
    memberIds = us.map((u) => u.id);
    members = us.map((u) => ({ id: u.id, name: u.name || u.email }));
    const ts = await prisma.team.findMany({ where: { isActive: true, organization: { type: 'INTERNAL' } }, select: { id: true, name: true } });
    teams = [];
    for (const t of ts) { const s = summarize(await load(teamTaskWhere(t.id), teamTicketWhere(t.id)), range); teams.push({ id: t.id, name: t.name, ...kpi(s) }); }
  } else throw new AppError('Unknown report scope.', 400);

  const s = summarize(rows, range);
  const ppl = await people(memberIds, range);
  if (members) {
    members = members.map((m) => {
      const mine = { tasks: rows.tasks.filter((t) => t.assigneeId === m.id || t.assignees.some((a) => a.userId === m.id)), tickets: rows.tickets.filter((t) => t.assigneeId === m.id) };
      return { ...m, ...kpi(summarize(mine, range)), comments: ppl.perUser.comments[m.id] || 0, updates: ppl.perUser.updates[m.id] || 0 };
    }).sort((a, b) => b.doneTasks + b.closedTickets - (a.doneTasks + a.closedTickets));
  }
  return { audience: staff ? 'staff' : 'client', label, type, range: { from: range.from, to: range.to }, generatedAt: new Date(), ...s, updates: ppl.updates, collab: ppl.collab, members, teams };
}
