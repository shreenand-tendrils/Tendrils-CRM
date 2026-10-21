/**
 * Normalise assignee input. `assigneeIds` (multi) wins over legacy `assigneeId`.
 * Returns undefined when the caller didn't touch assignees.
 */
export function resolveAssignees({ assigneeIds, assigneeId } = {}) {
  if (assigneeIds !== undefined) return [...new Set(assigneeIds)];
  if (assigneeId === null) return [];
  if (assigneeId) return [assigneeId];
  return undefined;
}
