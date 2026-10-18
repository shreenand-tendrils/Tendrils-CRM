// Mirrors enums in prisma/schema.prisma. test/schemas.test.js fails if they drift.
export const Priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const ProjectStatus = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];
export const TaskStatus = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];
export const TicketStatus = ['OPEN', 'TRIAGED', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'CLIENT_REVIEW', 'RESOLVED', 'CLOSED'];
export const Visibility = ['INTERNAL', 'CLIENT'];
