import { Router } from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/index.js';
import { AppError } from '../errors/AppError.js';

/**
 * Platform-admin reports: read-only. Nothing here writes to the database.
 *
 * Definitions (kept identical to the Overview analytics so the numbers agree):
 *  - owner team      = ticket.teamId (the team whose queue the ticket sits in)
 *  - participating   = other teams listed in TicketTeamAccess
 *  - opened (period) = ticket.createdAt inside the period
 *  - closed (period) = the latest "-> CLOSED" status event of the ticket is inside the period
 *                      (legacy rows without events fall back to ticket.closedAt)
 *  - closed by       = actor of that closing event (a client when the client approved the ticket)
 *  - raised by       = ticket.requesterId
 */
const router = Router();
router.use('/admin/reports', requirePermission('admin.view'));

const DAY = 86400000;
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const avg = (arr) => (arr.length ? r1(arr.reduce((s, x) => s + x, 0) / arr.length) : null);
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const parseDay = (v, fallback) => {
  const d = v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
};

router.get('/admin/reports', async (req, res) => {
  const now = new Date();
  const to0 = parseDay(req.query.to, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
  const from = parseDay(req.query.from, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));
  const to = new Date(to0.getTime() + DAY); // inclusive end day
  if (from >= to || to - from > 800 * DAY) throw new AppError('Pick a valid date range (up to about 2 years).', 400);
  const inRange = (d) => !!d && d >= from && d < to;
  const range = { gte: from, lt: to };

  const [teams, tickets, tasks] = await Promise.all([
    prisma.team.findMany({
      where: { isActive: true, organization: { type: 'INTERNAL' } },
      select: { id: true, name: true, members: { select: { membership: { select: { isActive: true, userId: true } } } } },
      orderBy: { name: 'asc' },
    }),
    prisma.ticket.findMany({
      where: {
        OR: [
          { createdAt: range }, { closedAt: range }, { status: { not: 'CLOSED' } },
          { events: { some: { type: 'STATUS', toValue: 'CLOSED', createdAt: range } } },
        ],
      },
      select: {
        id: true, key: true, title: true, status: true, progress: true, priority: true, createdAt: true, updatedAt: true, dueDate: true, closedAt: true,
        requesterId: true, assigneeId: true, teamId: true,
        organization: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        requester: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        teamAccesses: { select: { teamId: true, accessRole: true } },
        collaborators: { select: { userId: true } },
        events: { where: { type: 'STATUS', toValue: 'CLOSED' }, orderBy: { createdAt: 'desc' }, take: 1, select: { actorId: true, createdAt: true } },
        tasks: { select: { status: true } },
        _count: { select: { comments: true, attachments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
    prisma.task.findMany({
      where: { OR: [{ createdAt: range }, { completedAt: range }, { status: { not: 'DONE' } }] },
      select: { teamId: true, status: true, createdAt: true, completedAt: true, dueDate: true, assigneeId: true, assignees: { select: { userId: true } } },
      take: 20000,
    }),
  ]);

  // ---- who is who ------------------------------------------------------------------
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamsOfUser = new Map(); // userId -> [teamId]
  for (const t of teams) for (const m of t.members) if (m.membership.isActive) teamsOfUser.set(m.membership.userId, [...(teamsOfUser.get(m.membership.userId) || []), t.id]);

  const userIds = [...new Set([
    ...tickets.flatMap((t) => [t.events[0]?.actorId, t.requesterId, t.assigneeId]),
    ...tasks.flatMap((k) => [k.assigneeId, ...k.assignees.map((a) => a.userId)]),
    ...teamsOfUser.keys(),
  ].filter(Boolean))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, memberships: { where: { isActive: true }, select: { role: true, organization: { select: { type: true } } } } },
  });
  const userInfo = new Map(users.map((u) => [u.id, { id: u.id, name: u.name || u.email, email: u.email, roles: u.memberships.map((m) => m.role) }]));
  const nameOf = (u) => (u ? u.name || u.email : null);
  const isStaffUser = (id) => teamsOfUser.has(id) || (userInfo.get(id)?.roles || []).some((r) => r === 'PLATFORM_ADMIN' || r === 'EMPLOYEE');

  // ---- per-ticket derived values -----------------------------------------------------
  const rows = tickets.map((t) => {
    const closeEvt = t.events[0] || null;
    const closedAt = closeEvt?.createdAt || (t.status === 'CLOSED' ? t.closedAt : null);
    const closedById = closeEvt?.actorId || null;
    const open = t.status !== 'CLOSED';
    const ownerTeamId = t.teamId || t.teamAccesses.find((a) => a.accessRole === 'OWNER')?.teamId || null;
    const otherTeamIds = t.teamAccesses.map((a) => a.teamId).filter((id) => id !== ownerTeamId);
    const fromTeamIds = t.requesterId ? (teamsOfUser.get(t.requesterId) || []) : [];
    const done = t.tasks.filter((k) => k.status === 'DONE').length;
    return {
      ...t, closeEvt, closedAt, closedById, open, ownerTeamId, otherTeamIds, fromTeamIds,
      createdInRange: inRange(t.createdAt), closedInRange: inRange(closedAt),
      overdue: open && !!t.dueDate && t.dueDate < now,
      ageDays: Math.max(0, Math.floor(((closedAt && !open ? closedAt : now) - t.createdAt) / DAY)),
      tasksTotal: t.tasks.length, tasksDone: done,
    };
  });
  const crossTeam = (r) => r.fromTeamIds.length > 0 && !!r.ownerTeamId && !r.fromTeamIds.includes(r.ownerTeamId);

  // ---- totals ------------------------------------------------------------------------
  const closedRows = rows.filter((r) => r.closedInRange);
  const openRows = rows.filter((r) => r.open);
  const totals = {
    opened: rows.filter((r) => r.createdInRange).length,
    closed: closedRows.length,
    currentlyOpen: openRows.filter((r) => r.status === 'OPEN').length,
    reviewTest: openRows.filter((r) => r.status === 'REVIEW_TEST').length,
    reviewHelp: openRows.filter((r) => r.status === 'REVIEW_HELP').length,
    overdue: openRows.filter((r) => r.overdue).length,
    avgDaysToClose: avg(closedRows.map((r) => (r.closedAt - r.createdAt) / DAY)),
    avgOpenAgeDays: avg(openRows.map((r) => (now - r.createdAt) / DAY)),
    unassigned: openRows.filter((r) => !r.assigneeId).length,
    teamToTeam: rows.filter((r) => r.createdInRange && crossTeam(r)).length,
  };
  totals.closeRate = pct(totals.closed, totals.opened);

  const countBy = (list, key, values) => Object.fromEntries(values.map((v) => [v, list.filter((r) => r[key] === v).length]));
  const byStatus = countBy(openRows, 'status', ['OPEN', 'REVIEW_TEST', 'REVIEW_HELP']);
  byStatus.CLOSED = rows.filter((r) => r.status === 'CLOSED').length;
  const byPriority = {
    opened: countBy(rows.filter((r) => r.createdInRange), 'priority', ['URGENT', 'HIGH', 'MEDIUM', 'LOW']),
    open: countBy(openRows, 'priority', ['URGENT', 'HIGH', 'MEDIUM', 'LOW']),
  };

  // ---- months ------------------------------------------------------------------------
  const months = new Map();
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d < to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.set(monthKey(d), { month: monthKey(d), opened: 0, closed: 0 });
  for (const r of rows) {
    if (r.createdInRange) months.get(monthKey(r.createdAt)).opened += 1;
    if (r.closedInRange) months.get(monthKey(r.closedAt)).closed += 1;
  }

  // ---- team comparison -----------------------------------------------------------------
  const taskRows = tasks.map((k) => ({
    ...k,
    open: k.status !== 'DONE',
    people: [...new Set([k.assigneeId, ...k.assignees.map((a) => a.userId)].filter(Boolean))],
  }));
  const teamReport = teams.map((t) => {
    const memberIds = new Set(t.members.filter((m) => m.membership.isActive).map((m) => m.membership.userId));
    const owned = rows.filter((r) => r.ownerTeamId === t.id);
    const ownedOpen = owned.filter((r) => r.open);
    const ownedClosed = owned.filter((r) => r.closedInRange);
    const ownedOpened = owned.filter((r) => r.createdInRange);
    const mine = taskRows.filter((k) => k.teamId === t.id);
    return {
      id: t.id, name: t.name, members: memberIds.size,
      opened: ownedOpened.length,
      closed: ownedClosed.length,
      closeRate: pct(ownedClosed.length, ownedOpened.length),
      open: ownedOpen.filter((r) => r.status === 'OPEN').length,
      reviewTest: ownedOpen.filter((r) => r.status === 'REVIEW_TEST').length,
      reviewHelp: ownedOpen.filter((r) => r.status === 'REVIEW_HELP').length,
      overdue: ownedOpen.filter((r) => r.overdue).length,
      unassigned: ownedOpen.filter((r) => !r.assigneeId).length,
      urgentOpen: ownedOpen.filter((r) => r.priority === 'URGENT' || r.priority === 'HIGH').length,
      avgDaysToClose: avg(ownedClosed.map((r) => (r.closedAt - r.createdAt) / DAY)),
      avgOpenAgeDays: avg(ownedOpen.map((r) => (now - r.createdAt) / DAY)),
      oldestOpenDays: ownedOpen.length ? Math.max(...ownedOpen.map((r) => Math.floor((now - r.createdAt) / DAY))) : null,
      participating: rows.filter((r) => r.otherTeamIds.includes(t.id) && r.open).length,
      // people of this team raising / closing tickets
      raisedByMembers: rows.filter((r) => r.createdInRange && r.requesterId && memberIds.has(r.requesterId)).length,
      raisedForOtherTeams: rows.filter((r) => r.createdInRange && r.requesterId && memberIds.has(r.requesterId) && r.ownerTeamId && r.ownerTeamId !== t.id).length,
      receivedFromOtherTeams: ownedOpened.filter((r) => r.fromTeamIds.length > 0 && !r.fromTeamIds.includes(t.id)).length,
      receivedFromClients: ownedOpened.filter((r) => r.requesterId && !isStaffUser(r.requesterId)).length,
      closedByMembers: closedRows.filter((r) => r.closedById && memberIds.has(r.closedById)).length,
      tasksCreated: mine.filter((k) => inRange(k.createdAt)).length,
      tasksDone: mine.filter((k) => inRange(k.completedAt)).length,
      tasksOpen: mine.filter((k) => k.open).length,
      tasksOverdue: mine.filter((k) => k.open && k.dueDate && k.dueDate < now).length,
    };
  });

  // ---- people (who opens / closes most) ----------------------------------------------------
  const people = new Map();
  const person = (id) => {
    if (!id) return null;
    if (!people.has(id)) people.set(id, { id, opened: 0, closed: 0, assignedOpen: 0, assignedClosed: 0, overdue: 0, tasksDone: 0, tasksOpen: 0 });
    return people.get(id);
  };
  for (const r of rows) {
    if (r.createdInRange && r.requesterId) person(r.requesterId).opened += 1;
    if (r.closedInRange && r.closedById) person(r.closedById).closed += 1;
    if (r.assigneeId) {
      const p = person(r.assigneeId);
      if (r.open) { p.assignedOpen += 1; if (r.overdue) p.overdue += 1; } else if (r.closedInRange) p.assignedClosed += 1;
    }
  }
  for (const k of taskRows) for (const id of k.people) { const p = person(id); if (k.open) p.tasksOpen += 1; else if (inRange(k.completedAt)) p.tasksDone += 1; }
  const peopleOut = [...people.values()]
    .map((p) => {
      const info = userInfo.get(p.id) || {};
      const staff = isStaffUser(p.id);
      return { ...p, name: info.name || 'Unknown user', email: info.email || '', kind: staff ? 'STAFF' : 'CLIENT', teams: (teamsOfUser.get(p.id) || []).map((id) => teamById.get(id)?.name).filter(Boolean) };
    })
    .filter((p) => p.opened || p.closed || p.assignedOpen || p.assignedClosed || p.tasksDone || p.tasksOpen)
    .sort((a, b) => b.closed + b.opened - (a.closed + a.opened));

  // ---- clients -----------------------------------------------------------------------------
  const clients = new Map();
  for (const r of rows) {
    const c = clients.get(r.organization.id) || { id: r.organization.id, name: r.organization.name, opened: 0, closed: 0, open: 0, overdue: 0 };
    if (r.createdInRange) c.opened += 1;
    if (r.closedInRange) c.closed += 1;
    if (r.open) { c.open += 1; if (r.overdue) c.overdue += 1; }
    clients.set(c.id, c);
  }

  // ---- detailed ticket rows ---------------------------------------------------------------------
  const ticketsOut = rows.map((r) => ({
    id: r.id, key: r.key, title: r.title, status: r.status, progress: r.progress, priority: r.priority,
    client: r.organization.name, clientId: r.organization.id, project: r.project?.name || null,
    teamId: r.ownerTeamId, team: teamById.get(r.ownerTeamId)?.name || null,
    otherTeams: r.otherTeamIds.map((id) => teamById.get(id)?.name).filter(Boolean),
    fromTeams: r.fromTeamIds.map((id) => teamById.get(id)?.name).filter(Boolean),
    raisedBy: nameOf(r.requester), raisedById: r.requesterId, raisedByKind: r.requesterId ? (isStaffUser(r.requesterId) ? 'STAFF' : 'CLIENT') : null,
    assignee: nameOf(r.assignee), assigneeId: r.assigneeId, collaborators: r.collaborators.length,
    createdAt: r.createdAt, updatedAt: r.updatedAt, dueDate: r.dueDate,
    closedAt: r.open ? null : r.closedAt, closedBy: r.open ? null : nameOf(userInfo.get(r.closedById)), closedById: r.open ? null : r.closedById,
    ageDays: r.ageDays, overdue: r.overdue,
    tasksTotal: r.tasksTotal, tasksDone: r.tasksDone, comments: r._count.comments, files: r._count.attachments,
    createdInRange: r.createdInRange, closedInRange: r.closedInRange,
  }));

  res.json({
    range: { from: from.toISOString().slice(0, 10), to: to0.toISOString().slice(0, 10) },
    generatedAt: now.toISOString(),
    truncated: tickets.length >= 5000,
    totals, byStatus, byPriority, months: [...months.values()],
    teams: teamReport, people: peopleOut, clients: [...clients.values()].sort((a, b) => b.opened - a.opened),
    tickets: ticketsOut,
  });
});

export default router;
