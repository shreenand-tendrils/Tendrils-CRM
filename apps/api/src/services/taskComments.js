// Who hears about a new task comment: everyone on the task plus its creator, never the author, no duplicates.
export function taskCommentRecipients(task, authorId) {
  const ids = [task.creatorId, task.assigneeId, ...(task.assignees || []).map((a) => a.userId ?? a.user?.id)];
  return [...new Set(ids.filter((id) => id && id !== authorId))];
}
