// Ticket status + progress, and how they map to the auto-created task's status (pure, unit-tested). Review is not Done: only client approval closes the ticket and completes its mirror task.
//   Status:   OPEN | REVIEW_TEST | REVIEW_HELP | CLOSED
//   Progress: OPEN -> IN_PROGRESS | QA ; REVIEW_HELP -> NEED_MORE_INFO ; REVIEW_TEST -> RESOLVED ; CLOSED -> none
export const PROGRESS_FOR = { OPEN: ['IN_PROGRESS', 'QA'], REVIEW_HELP: ['NEED_MORE_INFO'], REVIEW_TEST: ['RESOLVED'], CLOSED: [] };
export const statusKey = (status, progress) => (progress ? `${status}:${progress}` : status);

/** Progress that goes with a status when nobody picked one. */
export function deriveProgress({ oldStatus, oldProgress, status, progress }) {
  if (progress !== undefined) return progress;
  if (status === 'OPEN') return oldStatus === 'OPEN' ? oldProgress ?? null : 'IN_PROGRESS';
  if (status === 'REVIEW_HELP') return 'NEED_MORE_INFO';
  if (status === 'REVIEW_TEST') return 'RESOLVED';
  return null;
}
export const progressValid = (status, progress) => !progress || (PROGRESS_FOR[status] || []).includes(progress);

export function ticketToTaskStatus(status, progress) {
  if (status === 'OPEN') return progress === 'IN_PROGRESS' || progress === 'QA' ? 'IN_PROGRESS' : 'TODO';
  if (status === 'REVIEW_HELP') return 'BLOCKED';
  if (status === 'REVIEW_TEST') return 'REVIEW'; // submitted to the client; not completed yet
  return 'DONE'; // only client approval closes the ticket and completes its mirror task
}
export const TASK_TO_TICKET = {
  BACKLOG: { status: 'OPEN', progress: null }, TODO: { status: 'OPEN', progress: null }, IN_PROGRESS: { status: 'OPEN', progress: 'IN_PROGRESS' },
  REVIEW: { status: 'REVIEW_TEST', progress: 'RESOLVED' }, BLOCKED: { status: 'REVIEW_HELP', progress: 'NEED_MORE_INFO' }, DONE: { status: 'CLOSED', progress: null },
};
export const taskTitleFor = (t) => `[${t.key}] ${t.title}`;
