import { ROLE_LABELS } from "./rbac.js";

// Helpers for "pick the team first, then the assignee from that team".

const memberRole = (m) => m?.membership?.role;

/** [{ id, name, email, role, roleLabel, label }] for one team, sorted by name. */
export function teamPeople(teams = [], teamId) {
  const team = teams.find((t) => t.id === teamId);
  if (!team) return [];
  return (team.members || [])
    .map((m) => ({ u: m?.membership?.user, role: memberRole(m) }))
    .filter(({ u }) => u?.id)
    .map(({ u, role }) => ({
      id: u.id, name: u.name, email: u.email, role, roleLabel: ROLE_LABELS[role] || "",
      label: `${u.name || u.email}${role ? ` — ${ROLE_LABELS[role] || role}` : ""}`,
    }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

/** Owner team first, then participating teams: [{ team, people }] */
export function assigneeGroups(teams = [], ownerTeamId, participantIds = []) {
  const ids = [...new Set([ownerTeamId, ...participantIds].filter(Boolean))];
  return ids.map((id) => ({ team: teams.find((t) => t.id === id), people: teamPeople(teams, id), owner: id === ownerTeamId })).filter((g) => g.team);
}

export const isInTeams = (teams, teamIds, userId) => teamIds.some((id) => teamPeople(teams, id).some((p) => p.id === userId));

/** Full owning/shared team names for staff and client ticket tables. */
export function ticketTeamLabel(ticket) {
  const accesses = ticket?.teamAccesses || [];
  if (!accesses.length) return null;
  const owner = accesses.find((a) => a.teamId === ticket.teamId) || accesses[0];
  const others = accesses.filter((a) => a.teamId !== owner.teamId);
  return [owner.team?.name || "Team", ...others.map((a) => a.team?.name).filter(Boolean)].join(" + ");
}

/** Everyone in any of the given teams, de-duplicated (a person in two teams appears once). */
export function peopleOfTeams(teams = [], teamIds = []) {
  const seen = new Map();
  for (const id of teamIds.filter(Boolean)) for (const p of teamPeople(teams, id)) if (!seen.has(p.id)) seen.set(p.id, p);
  return [...seen.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

export const sameIds = (a = [], b = []) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
