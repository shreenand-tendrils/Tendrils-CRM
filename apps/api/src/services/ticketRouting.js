// Pure routing rules for tickets (no DB access, easy to unit-test).
//
//  1. A ticket is routed to an OWNING team first (optionally + participating teams).
//  2. The assignee must belong to one of those teams.
//  3. If the owning team changes and the current assignee does not belong to the new teams,
//     the assignee is cleared automatically (so nobody ends up holding a ticket they can't see).

/** Owner team + participating teams, de-duplicated, owner first. */
export function accessTeamIdsFor(ownerTeamId, participantIds = []) {
  return [...new Set([...(ownerTeamId ? [ownerTeamId] : []), ...participantIds])];
}

/** membersByTeam: Map<teamId, Set<userId>> (or plain object of arrays). */
export function isMemberOfAnyTeam(userId, teamIds, membersByTeam) {
  const get = (id) => (membersByTeam instanceof Map ? membersByTeam.get(id) : membersByTeam?.[id]);
  return teamIds.some((id) => {
    const m = get(id);
    return m instanceof Set ? m.has(userId) : Array.isArray(m) && m.includes(userId);
  });
}

/**
 * Decide what the assignee becomes after a ticket update.
 * - `old`  : { assigneeId }
 * - `data` : parsed PATCH body (assigneeId may be undefined = untouched)
 * - `accessIds` : owner + participating team ids AFTER the update
 * Returns { assigneeId (undefined = leave as is), autoUnassigned, error }.
 */
export function planAssignee({ old, data, accessIds, membersByTeam, routingTouched }) {
  const explicit = data.assigneeId !== undefined;
  const next = explicit ? data.assigneeId : old.assigneeId;
  if (!next) return { assigneeId: explicit ? null : undefined, autoUnassigned: false, error: null };
  if (!explicit && !routingTouched) return { assigneeId: undefined, autoUnassigned: false, error: null }; // untouched legacy data
  if (!accessIds.length) {
    return { assigneeId: undefined, autoUnassigned: false, error: { status: 409, code: 'TICKET_NOT_ROUTED', message: 'Pick a team first, then choose an assignee from that team.' } };
  }
  if (isMemberOfAnyTeam(next, accessIds, membersByTeam)) return { assigneeId: explicit ? next : undefined, autoUnassigned: false, error: null };
  if (explicit) {
    return { assigneeId: undefined, autoUnassigned: false, error: { status: 400, code: 'ASSIGNEE_NOT_IN_TEAM', message: 'The assignee must be a member of the ticket’s team.' } };
  }
  return { assigneeId: null, autoUnassigned: true, error: null };
}

/**
 * Decide the collaborator list after a ticket update. Collaborators are picked from the members of ALL the ticket's
 * teams (owner + shared), irrespective of which of those teams each person is in. The assignee is never also a collaborator.
 * - `current`   : collaborator ids now on the ticket
 * - `requested` : collaboratorIds from the request (undefined = untouched)
 * - `accessIds` : owner + shared team ids AFTER the update
 * - `assigneeId`: assignee AFTER the update
 * Returns { ids, added, removed, autoRemoved (ids dropped because they left the teams), error }.
 */
export function planCollaborators({ current = [], requested, accessIds = [], membersByTeam, assigneeId = null, routingTouched = false }) {
  const explicit = requested !== undefined;
  const base = explicit ? [...new Set(requested)] : [...current];
  const done = (ids, autoRemoved = []) => {
    const next = ids.filter((id) => id !== assigneeId);
    return { ids: next, added: next.filter((id) => !current.includes(id)), removed: current.filter((id) => !next.includes(id)), autoRemoved, error: null };
  };
  if (!explicit && !routingTouched) return done(base); // nothing about teams or collaborators changed: only keep the assignee out of the list
  if (!base.length) return done([]);
  if (!accessIds.length) {
    if (explicit) return { ids: current, added: [], removed: [], autoRemoved: [], error: { status: 409, code: 'TICKET_NOT_ROUTED', message: 'Pick a team first, then choose collaborators from the ticket’s teams.' } };
    return done([], base); // teams were removed: nobody can stay
  }
  const outside = base.filter((id) => !isMemberOfAnyTeam(id, accessIds, membersByTeam));
  if (outside.length && explicit) return { ids: current, added: [], removed: [], autoRemoved: [], error: { status: 400, code: 'COLLABORATOR_NOT_IN_TEAM', message: 'Collaborators must be members of the ticket’s team(s).' } };
  return done(base.filter((id) => !outside.includes(id)), outside);
}

/** Ids from `ids` that are NOT members of any of `teamIds` (empty array = everyone fits). Used for tasks. */
export function assigneesOutsideTeams(ids = [], teamIds = [], membersByTeam) {
  return ids.filter((id) => !isMemberOfAnyTeam(id, teamIds, membersByTeam));
}

/** A client may pick one or more teams: the first owns the ticket, the rest are shared. Returns { teamId, teamIds }. */
export function normalizeTeamPicks(teamId, teamIds = []) {
  const picks = [...new Set([teamId, ...teamIds].filter(Boolean))];
  return { teamId: picks[0] || null, teamIds: picks.slice(1) };
}
