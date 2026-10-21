// Pure helpers that turn a ticket change into history events (no DB access, unit-tested).

export const CLIENT_STATUS_LABEL = { OPEN: 'Received', TRIAGED: 'Reviewed by the team', IN_PROGRESS: 'In progress', BLOCKED: 'In progress', REVIEW: 'In progress', CLIENT_REVIEW: 'Waiting for your review', RESOLVED: 'Done', CLOSED: 'Closed' };
const dateKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Events for a ticket update.
 * names: { users: {id: name}, teams: {id: name}, projects: {id: name} }
 */
export function diffTicketEvents({ old, updated, oldTeamIds = [], newTeamIds = [], names = {} }) {
  const out = [];
  const user = (id) => (id ? names.users?.[id] || 'Unknown user' : null);
  const team = (id) => (id ? names.teams?.[id] || 'Unknown team' : null);
  const add = (type, fromValue, toValue, extra = {}) => out.push({ type, fromValue: fromValue ?? null, toValue: toValue ?? null, clientVisible: false, ...extra });

  if (old.title !== updated.title) add('TITLE', old.title, updated.title, { fromLabel: old.title, toLabel: updated.title, clientVisible: true });
  if ((old.description || '') !== (updated.description || '')) add('DESCRIPTION', null, null, { clientVisible: true });
  if (old.status !== updated.status) add('STATUS', old.status, updated.status, { clientVisible: true });
  if (old.priority !== updated.priority) add('PRIORITY', old.priority, updated.priority, { clientVisible: true });
  if (dateKey(old.dueDate) !== dateKey(updated.dueDate)) add('DUE_DATE', dateKey(old.dueDate), dateKey(updated.dueDate), { fromLabel: dateKey(old.dueDate), toLabel: dateKey(updated.dueDate), clientVisible: true });
  if (old.visibility !== updated.visibility) add('VISIBILITY', old.visibility, updated.visibility);
  if ((old.projectId || null) !== (updated.projectId || null)) add('PROJECT', old.projectId, updated.projectId, { fromLabel: names.projects?.[old.projectId] || null, toLabel: names.projects?.[updated.projectId] || null });
  if ((old.teamId || null) !== (updated.teamId || null)) add('TEAM', old.teamId, updated.teamId, { fromLabel: team(old.teamId), toLabel: team(updated.teamId) });
  if ((old.assigneeId || null) !== (updated.assigneeId || null)) add('ASSIGNEE', old.assigneeId, updated.assigneeId, { fromLabel: user(old.assigneeId), toLabel: user(updated.assigneeId) });

  // Participating teams (the owner team is reported by TEAM, so leave it out here).
  const ownerIds = new Set([old.teamId, updated.teamId].filter(Boolean));
  const before = new Set(oldTeamIds.filter((id) => !ownerIds.has(id)));
  const after = new Set(newTeamIds.filter((id) => !ownerIds.has(id)));
  for (const id of after) if (!before.has(id)) add('TEAM_ACCESS', null, id, { toLabel: team(id) });
  for (const id of before) if (!after.has(id)) add('TEAM_ACCESS', id, null, { fromLabel: team(id) });
  return out;
}

/** What a client may see: only client-visible events, with staff-only status detail collapsed. */
export function clientView(events) {
  return events
    .filter((e) => e.clientVisible)
    .map((e) => {
      if (e.type !== 'STATUS') return e;
      return { ...e, fromLabel: CLIENT_STATUS_LABEL[e.fromValue] || e.fromValue, toLabel: CLIENT_STATUS_LABEL[e.toValue] || e.toValue };
    })
    .filter((e) => e.type !== 'STATUS' || e.fromLabel !== e.toLabel);
}
