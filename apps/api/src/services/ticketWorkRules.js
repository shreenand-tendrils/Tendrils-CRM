/** Actual linked work must be DONE before a ticket is submitted for review or closed. */
export function incompleteWorkTasks(tasks = []) {
  // The auto-created task mirrors the ticket status; other linked tasks/subtasks are real work.
  return tasks.filter((task) => !task.autoCreated && task.status !== 'DONE');
}
