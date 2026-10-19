import { prisma } from '../db.js';

/** Persist history events. `db` is prisma or a transaction client. Never throws: history must not break the real action. */
export async function recordTicketEvents(db, ticketId, actorId, events = []) {
  if (!events.length) return;
  try {
    await (db || prisma).ticketEvent.createMany({ data: events.map((e) => ({ ticketId, actorId: actorId || null, ...e })) });
  } catch (err) {
    console.error(`[ticket history] could not record events for ${ticketId}:`, err.message);
  }
}

/** Display names for the ids mentioned in an update, so labels survive later renames/deletes. */
export async function loadNames({ userIds = [], teamIds = [], projectIds = [] }) {
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const [users, teams, projects] = await Promise.all([
    uniq(userIds).length ? prisma.user.findMany({ where: { id: { in: uniq(userIds) } }, select: { id: true, name: true, email: true } }) : [],
    uniq(teamIds).length ? prisma.team.findMany({ where: { id: { in: uniq(teamIds) } }, select: { id: true, name: true } }) : [],
    uniq(projectIds).length ? prisma.project.findMany({ where: { id: { in: uniq(projectIds) } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    users: Object.fromEntries(users.map((u) => [u.id, u.name || u.email])),
    teams: Object.fromEntries(teams.map((t) => [t.id, t.name])),
    projects: Object.fromEntries(projects.map((p) => [p.id, p.name])),
  };
}
