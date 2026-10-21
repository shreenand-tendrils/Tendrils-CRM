// Pure status mappings between tickets and their auto-created task (no DB access, unit-tested).
export const TICKET_TO_TASK = { OPEN: 'TODO', TRIAGED: 'TODO', IN_PROGRESS: 'IN_PROGRESS', BLOCKED: 'BLOCKED', REVIEW: 'REVIEW', CLIENT_REVIEW: 'REVIEW', RESOLVED: 'DONE', CLOSED: 'DONE' };
export const TASK_TO_TICKET = { TODO: 'TRIAGED', IN_PROGRESS: 'IN_PROGRESS', BLOCKED: 'BLOCKED', REVIEW: 'REVIEW', DONE: 'RESOLVED' };
export const taskTitleFor = (t) => `[${t.key}] ${t.title}`;
