import { z } from 'zod';
import { Priority, ProjectStatus, TaskStatus, TicketStatus, Visibility } from './enums.js';

const en = (values) => z.enum(values);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * ROOT-CAUSE FIX: accept BOTH `YYYY-MM-DD` (HTML <input type="date">) and full
 * ISO datetimes, and always output a JS Date. Empty string => undefined (create)
 * or null (update, clears the field).
 */
const dateCore = z
  .string()
  .trim()
  .refine((v) => DATE_ONLY.test(v) || ISO_DATETIME.test(v), 'Invalid date (use YYYY-MM-DD or ISO datetime)')
  .transform((v) => new Date(DATE_ONLY.test(v) ? `${v}T00:00:00.000Z` : v))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');

// Reject calendar overflow like 2026-02-31 (JS silently rolls it to March 3).
const realCalendarDay = z.string().refine((v) => {
  if (!DATE_ONLY.test(v.trim())) return true;
  const [y, m, d] = v.trim().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}, 'Invalid calendar date');

const dateStr = realCalendarDay.pipe(dateCore);
const emptyTo = (val) => (v) => (v === '' ? val : v);
const optDate = z.preprocess(emptyTo(undefined), dateStr.optional());
const nullDate = z.preprocess(emptyTo(null), dateStr.nullable().optional());

const id = z.string().min(1);
const optId = id.optional();
const idList = z.array(id).max(25);
const nullId = z.preprocess((v) => (v === '' ? null : v), id.nullable()).optional();

export const organizationCreate = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes'),
});

export const projectCreate = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().optional(),
  organizationId: id,
  status: en(ProjectStatus).default('ACTIVE'),
  startDate: optDate,
  dueDate: optDate,
  memberIds: idList.optional(),
  teamIds: idList.optional(),
});

export const taskCreate = z.object({
  title: z.string().trim().min(2).max(220),
  description: z.string().optional(),
  organizationId: id,
  projectId: optId,
  ticketId: optId,
  parentId: optId,
  teamId: optId,
  teamIds: idList.optional(),
  assigneeId: optId,
  assigneeIds: idList.optional(),
  priority: en(Priority).default('MEDIUM'),
  status: en(TaskStatus).default('TODO'),
  dueDate: optDate,
});

export const taskUpdate = z.object({
  title: z.string().trim().min(2).max(220).optional(),
  description: z.string().nullable().optional(),
  status: en(TaskStatus).optional(),
  priority: en(Priority).optional(),
  assigneeId: nullId,
  assigneeIds: idList.optional(),
  dueDate: nullDate,
  position: z.number().int().min(0).optional(),
  teamId: nullId,
  teamIds: idList.optional(),
  parentId: nullId,
});

export const ticketCreate = z.object({
  title: z.string().trim().min(3).max(220),
  description: z.string().optional(),
  organizationId: id,
  projectId: optId,
  priority: en(Priority).default('MEDIUM'),
  visibility: en(Visibility).default('CLIENT'),
  assigneeId: optId,
  teamId: optId,
  teamIds: idList.optional(),
  dueDate: optDate,
});

export const ticketUpdate = z.object({
  title: z.string().trim().min(3).max(220).optional(),
  description: z.string().nullable().optional(),
  status: en(TicketStatus).optional(),
  priority: en(Priority).optional(),
  visibility: en(Visibility).optional(),
  assigneeId: nullId,
  teamId: nullId,
  teamIds: idList.optional(),
  projectId: nullId,
  dueDate: nullDate,
});

export const commentCreate = z.object({
  body: z.string().trim().min(1).max(10000),
  visibility: en(Visibility).default('CLIENT'),
});

export const teamCreate = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes'),
  organizationId: id,
  description: z.string().optional(),
});

export const projectMembersSet = z.object({ memberIds: idList, leadId: optId, teamIds: idList.optional() });
export const projectRequest = z.object({ name: z.string().trim().min(2).max(160), description: z.string().optional(), organizationId: id, startDate: optDate, dueDate: optDate, teamIds: idList.optional() });

export const chatMessageCreate = z.object({
  body: z.string().trim().min(1).max(4000),
  replyToId: optId, // reply to a specific message in the same room
  mentionIds: z.array(id).max(10).optional(), // people "pinged" with @name: they get a notification (and an email if offline)
});
export const chatMessageEdit = z.object({ body: z.string().trim().min(1).max(4000) });

export const dailyUpdateUpsert = z.object({
  date: optDate, // YYYY-MM-DD from the user's local calendar; defaults to today (UTC)
  yesterday: z.string().trim().min(2).max(5000),
  today: z.string().trim().min(2).max(5000),
  blockers: z.preprocess(emptyTo(undefined), z.string().trim().max(5000).optional()),
  projectId: optId,
});

export const dmCreate = z.object({ userId: id });

const ROLES = ['PLATFORM_ADMIN', 'MANAGER', 'EMPLOYEE', 'CLIENT_ADMIN', 'CLIENT_MEMBER'];
const email = z.string().trim().toLowerCase().email().max(200);
// Manual provisioning (admin adds the person directly; they can sign in with Google straight away).
export const memberInvite = z.object({
  email,
  name: z.preprocess(emptyTo(undefined), z.string().trim().min(1).max(120).optional()),
  organizationId: id,
  role: z.enum(ROLES),
  teamIds: idList.optional(), // internal workspaces only: a member can belong to several teams
  notify: z.boolean().default(true), // send a "you now have access" email
});
// Email invitation: nothing is granted until the person signs in with Google using this exact (verified) email.
export const invitationCreate = z.object({
  email,
  organizationId: id,
  role: z.enum(ROLES),
  teamIds: idList.optional(),
});
export const memberTeamsSet = z.object({ teamIds: idList });
export const teamMembersSet = z.object({ membershipIds: z.array(id).max(200) });
export const projectUpdateCreate = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(5000),
});
export const memberUpdate = z
  .object({ role: z.enum(ROLES).optional(), isActive: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, 'Nothing to change');
