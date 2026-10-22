// Ticket status + progress, and how they map to the auto-created task's status (pure, unit-tested).
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
  if (status === 'OPEN') return progress === 'QA' ? 'REVIEW' : progress === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'TODO';
  if (status === 'REVIEW_HELP') return 'BLOCKED';
  return 'DONE'; // REVIEW_TEST (resolved, waiting for the client) and CLOSED
}
export const TASK_TO_TICKET = {
  BACKLOG: { status: 'OPEN', progress: null }, TODO: { status: 'OPEN', progress: null }, IN_PROGRESS: { status: 'OPEN', progress: 'IN_PROGRESS' },
  REVIEW: { status: 'OPEN', progress: 'QA' }, BLOCKED: { status: 'REVIEW_HELP', progress: 'NEED_MORE_INFO' }, DONE: { status: 'REVIEW_TEST', progress: 'RESOLVED' },
};
export const taskTitleFor = (t) => `[${t.key}] ${t.title}`;
