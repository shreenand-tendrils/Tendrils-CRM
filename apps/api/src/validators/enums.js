// Mirrors enums in prisma/schema.prisma. test/schemas.test.js fails if they drift.
export const Priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const ProjectStatus = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];
export const TaskStatus = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];
export const TicketStatus = ['OPEN', 'REVIEW_TEST', 'REVIEW_HELP', 'CLOSED'];
export const TicketProgress = ['IN_PROGRESS', 'QA', 'NEED_MORE_INFO', 'RESOLVED'];
export const Visibility = ['INTERNAL', 'CLIENT'];
