import { z } from 'zod';
import { ApiError } from '../services/internalApi.js';
import { TaskStatus, TicketStatus, TicketProgress, Priority } from '../validators/enums.js';

/**
 * ONE tool registry, two front doors: the MCP server (Claude Desktop / Claude Code / any MCP client)
 * and the WhatsApp AI assistant. Every handler calls the REST API as the signed-in user (see internalApi.js),
 * so a tool can never do more than that person could do in the web app.
 *   write:true  => changes data. MCP clients show a confirmation; WhatsApp asks the user to reply YES.
 */
const person = (p) => (p ? p.name || p.email : null);
const day = (d) => (d ? String(d).slice(0, 10) : null);
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export const compactTicket = (t) => ({
  id: t.id, key: t.key, title: t.title, status: t.status, progress: t.progress || null, priority: t.priority,
  client: t.organization?.name, project: t.project?.name || null,
  teams: (t.teamAccesses || []).map((a) => a.team?.name).filter(Boolean),
  assignee: person(t.assignee), requester: person(t.requester), due: day(t.dueDate), tasksWaitingClientReview: t.tasksInReview || 0,
  created: day(t.createdAt),
});
export const compactTask = (t) => ({
  id: t.id, title: t.title, status: t.status, priority: t.priority, due: day(t.dueDate),
  ticket: t.ticket?.key || null, assignees: [...new Set([person(t.assignee), ...(t.assignees || []).map((a) => person(a.user))].filter(Boolean))],
  team: t.team?.name || null, isSubtask: !!t.parentId,
});

export async function findTicket(api, ref) {
  const r = String(ref || '').trim();
  if (!r) throw new ApiError(400, 'Give a ticket key (like SOF-123456).');
  const hit = (list) => list.find((t) => t.id === r || same(t.key, r));
  let t = hit(await api.get('/tickets', { q: r }));
  if (!t && !r.includes('-')) t = hit(await api.get('/tickets'));
  if (!t) throw new ApiError(404, `Ticket "${r}" not found (or you cannot see it).`);
  return t;
}
function pickByName(list, name, label, fields = ['name']) {
  const n = String(name || '').trim();
  const exact = list.filter((x) => fields.some((f) => same(x[f], n)) || x.id === n);
  const found = exact.length ? exact : list.filter((x) => fields.some((f) => String(x[f] || '').toLowerCase().includes(n.toLowerCase())));
  if (found.length === 1) return found[0];
  const names = list.slice(0, 12).map((x) => x[fields[0]]).join(', ');
  throw new ApiError(400, found.length ? `"${name}" matches several ${label}s. Be more specific.` : `No ${label} called "${name}". Options: ${names}`);
}
const orgIdFor = async (api, name) => {
  const orgs = await api.get('/organizations');
  if (name) return pickByName(orgs, name, 'client/workspace').id;
  if (orgs.length === 1) return orgs[0].id;
  throw new ApiError(400, `Which client/workspace? Options: ${orgs.map((o) => o.name).join(', ')}`, 'ORG_REQUIRED');
};
const teamIdFor = async (api, me, name) => {
  if (!name) return undefined;
  const list = me.isInternal ? await api.get('/teams') : await api.get('/teams/requestable');
  return pickByName(list, name, 'team').id;
};
const userIdFor = async (api, who) => {
  if (!who) return undefined;
  const list = await api.get('/users'); // needs user.list; a 403 explains itself
  return pickByName(list, who, 'person', ['email', 'name']).id;
};

const ticketRef = z.string().describe('Ticket key such as SOF-123456 (or its id)');
const taskStatus = z.enum(TaskStatus);

export const TOOLS = [
  {
    name: 'whoami', title: 'Who am I', write: false,
    description: 'Current user, roles, teams and workspaces. Call first when unsure what the user may do.',
    shape: {},
    run: async (api) => {
      const me = await api.get('/me');
      return { name: me.user.name, email: me.user.email, isStaff: me.isInternal, roles: me.roles, workspaces: me.memberships.map((m) => ({ name: m.organization.name, role: m.role, teams: m.teams })), canCreateTickets: me.permissions.includes('ticket.create') };
    },
  },
  {
    name: 'dashboard_summary', title: 'Dashboard summary', write: false,
    description: 'Counts of open projects, tickets, tasks, overdue tasks and unread notifications for the user.',
    shape: {},
    run: async (api) => (await api.get('/dashboard')).metrics,
  },
  {
    name: 'list_tickets', title: 'List tickets', write: false,
    description: 'Search/list tickets the user can see. Filter by text, status or "mine" (assigned to or raised by the user).',
    shape: {
      query: z.string().optional().describe('Text in title or key'),
      status: z.enum(TicketStatus).optional(), mine: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional(),
    },
    run: async (api, { query, status, mine, limit = 15 }) => {
      const me = mine ? await api.get('/me') : null;
      let rows = await api.get('/tickets', query ? { q: query } : undefined);
      if (status) rows = rows.filter((t) => t.status === status);
      if (mine) rows = rows.filter((t) => t.assignee?.id === me.user.id || t.requester?.id === me.user.id);
      return { total: rows.length, tickets: rows.slice(0, limit).map(compactTicket) };
    },
  },
  {
    name: 'get_ticket', title: 'Get ticket details', write: false,
    description: 'Full picture of one ticket: fields, work items (tasks), recent comments and history.',
    shape: { ticket: ticketRef },
    run: async (api, { ticket }) => {
      const t = await findTicket(api, ticket);
      const [tasks, comments, history] = await Promise.all([api.get(`/tickets/${t.id}/tasks`), api.get(`/tickets/${t.id}/comments`), api.get(`/tickets/${t.id}/history`)]);
      return {
        ...compactTicket(t), description: (t.description || '').slice(0, 1500),
        tasks: tasks.map((x) => ({ id: x.id, title: x.title, status: x.status, assignees: x.assignees.map((a) => person(a.user)), isSubtask: !!x.parentId })),
        comments: comments.slice(-8).map((c) => ({ by: person(c.author), visibility: c.visibility, at: day(c.createdAt), body: c.body.slice(0, 500) })),
        history: history.slice(0, 8).map((e) => ({ at: day(e.createdAt), type: e.type, by: person(e.actor), from: e.fromLabel, to: e.toLabel, note: e.note })),
      };
    },
  },
  {
    name: 'create_ticket', title: 'Create ticket', write: true,
    description: 'Raise a ticket. Clients must pick a team. Staff: client/workspace is needed if they can see several.',
    shape: {
      title: z.string().min(3).max(220), description: z.string().optional(),
      client: z.string().optional().describe('Client/workspace name (if more than one is visible)'),
      team: z.string().optional().describe('Owning team name, e.g. SEO, IT'),
      priority: z.enum(Priority).optional(), due_date: z.string().optional().describe('YYYY-MM-DD'),
    },
    run: async (api, a) => {
      const me = await api.get('/me');
      const t = await api.post('/tickets', {
        title: a.title, description: a.description, organizationId: await orgIdFor(api, a.client), teamId: await teamIdFor(api, me, a.team),
        priority: a.priority, dueDate: a.due_date || undefined,
      });
      return { created: t.key, id: t.id };
    },
  },
  {
    name: 'update_ticket', title: 'Update ticket', write: true,
    description: 'Change a ticket status/progress/priority/assignee. Server rules apply (e.g. employees cannot close client tickets).',
    shape: {
      ticket: ticketRef, status: z.enum(TicketStatus).optional(), progress: z.enum(TicketProgress).optional(),
      priority: z.enum(Priority).optional(), assignee: z.string().optional().describe('Email or name of a staff member'),
    },
    run: async (api, { ticket, status, progress, priority, assignee }) => {
      const t = await findTicket(api, ticket);
      const body = { ...(status && { status }), ...(progress && { progress }), ...(priority && { priority }), ...(assignee && { assigneeId: await userIdFor(api, assignee) }) };
      if (!Object.keys(body).length) throw new ApiError(400, 'Nothing to change.');
      const u = await api.patch(`/tickets/${t.id}`, body);
      return { updated: t.key, status: u.status, progress: u.progress, priority: u.priority };
    },
  },
  {
    name: 'comment_ticket', title: 'Comment on ticket', write: true,
    description: 'Add a comment. Staff comments are internal unless client_visible=true. Client comments are always visible to the team.',
    shape: { ticket: ticketRef, body: z.string().min(1).max(4000), client_visible: z.boolean().optional() },
    run: async (api, { ticket, body, client_visible }) => {
      const t = await findTicket(api, ticket);
      const me = await api.get('/me');
      await api.post(`/tickets/${t.id}/comments`, { body, visibility: me.isInternal && !client_visible ? 'INTERNAL' : 'CLIENT' });
      return { commented: t.key };
    },
  },
  {
    name: 'list_tasks', title: 'List tasks', write: false,
    description: 'Tasks and subtasks visible to staff (clients have none). Filter by mine, status or ticket key.',
    shape: { mine: z.boolean().optional(), status: taskStatus.optional(), ticket: z.string().optional(), include_done: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() },
    run: async (api, { mine, status, ticket, include_done, limit = 20 }) => {
      let rows = await api.get('/tasks', mine ? { mine: 'true' } : undefined);
      if (status) rows = rows.filter((t) => t.status === status);
      else if (!include_done) rows = rows.filter((t) => t.status !== 'DONE');
      if (ticket) rows = rows.filter((t) => same(t.ticket?.key, ticket));
      rows = rows.filter((t) => !t.autoCreated);
      return { total: rows.length, tasks: rows.slice(0, limit).map(compactTask) };
    },
  },
  {
    name: 'update_task', title: 'Update task', write: true,
    description: 'Change task status/priority/due date. Only the assignee can change a task status (server rule).',
    shape: { task: z.string().describe('Task id from list_tasks'), status: taskStatus.optional(), priority: z.enum(Priority).optional(), due_date: z.string().optional().describe('YYYY-MM-DD') },
    run: async (api, { task, status, priority, due_date }) => {
      const body = { ...(status && { status }), ...(priority && { priority }), ...(due_date && { dueDate: due_date }) };
      if (!Object.keys(body).length) throw new ApiError(400, 'Nothing to change.');
      const u = await api.patch(`/tasks/${task}`, body);
      return { updated: u.id, title: u.title, status: u.status };
    },
  },
  {
    name: 'create_task', title: 'Create task', write: true,
    description: 'Create a task (optionally under a ticket, optionally assigned).',
    shape: {
      title: z.string().min(2).max(220), description: z.string().optional(), ticket: z.string().optional().describe('Ticket key to attach to'),
      team: z.string().optional(), assignee: z.string().optional().describe('Email or name'), priority: z.enum(Priority).optional(), due_date: z.string().optional(),
    },
    run: async (api, a) => {
      const me = await api.get('/me');
      const t = a.ticket ? await findTicket(api, a.ticket) : null;
      const orgId = t?.organization?.id || me.memberships.find((m) => m.organization.type === 'INTERNAL')?.organization.id;
      const created = await api.post('/tasks', {
        title: a.title, description: a.description, organizationId: orgId, ticketId: t?.id, teamId: await teamIdFor(api, me, a.team),
        assigneeId: await userIdFor(api, a.assignee), priority: a.priority, dueDate: a.due_date || undefined,
      });
      return { created: created.id, title: created.title };
    },
  },
  {
    name: 'comment_task', title: 'Comment on task', write: true,
    description: 'Add an internal comment to a task.',
    shape: { task: z.string(), body: z.string().min(1).max(4000) },
    run: async (api, { task, body }) => { await api.post(`/tasks/${task}/comments`, { body }); return { commented: task }; },
  },
  {
    name: 'tasks_waiting_my_review', title: 'Tasks waiting for my review', write: false,
    description: 'For clients: tasks of their tickets that the team marked ready for review.',
    shape: {},
    run: async (api) => {
      const tickets = (await api.get('/tickets')).filter((t) => t.tasksInReview > 0);
      const out = [];
      for (const t of tickets.slice(0, 10)) {
        const tasks = await api.get(`/tickets/${t.id}/tasks`);
        for (const x of tasks.filter((k) => k.status === 'REVIEW')) out.push({ ticket: t.key, ticketTitle: t.title, taskId: x.id, task: x.title });
      }
      return out;
    },
  },
  {
    name: 'review_task', title: 'Approve or send back a task', write: true,
    description: 'Client review of a task: APPROVE, or CHANGES with a note on what to change. The last approval closes the ticket.',
    shape: { ticket: ticketRef, task_id: z.string(), decision: z.enum(['APPROVE', 'CHANGES']), note: z.string().max(2000).optional() },
    run: async (api, { ticket, task_id, decision, note }) => {
      const t = await findTicket(api, ticket);
      const r = await api.post(`/tickets/${t.id}/tasks/${task_id}/review`, { decision, note });
      return { ticket: t.key, taskStatus: r.task.status, ticketStatus: r.ticketStatus, ticketClosed: r.closed };
    },
  },
  {
    name: 'list_notifications', title: 'List notifications', write: false,
    description: 'Recent in-app notifications for the user.',
    shape: { unread_only: z.boolean().optional(), limit: z.number().int().min(1).max(30).optional() },
    run: async (api, { unread_only, limit = 10 }) => {
      let rows = await api.get('/notifications');
      if (unread_only) rows = rows.filter((n) => !n.readAt);
      return rows.slice(0, limit).map((n) => ({ type: n.type, title: n.title, body: n.body.slice(0, 200), at: day(n.createdAt), unread: !n.readAt }));
    },
  },
  {
    name: 'mark_notifications_read', title: 'Mark notifications read', write: true,
    description: 'Mark all of the user\'s notifications as read.', shape: {},
    run: async (api) => api.post('/notifications/read-all'),
  },
  {
    name: 'list_teams', title: 'List teams', write: false,
    description: 'Teams that work can be routed to.', shape: {},
    run: async (api) => {
      const me = await api.get('/me');
      return (me.isInternal ? await api.get('/teams') : await api.get('/teams/requestable')).map((t) => ({ name: t.name, members: t._count?.members }));
    },
  },
  {
    name: 'list_projects', title: 'List projects', write: false,
    description: 'Projects the user can see, with status and due date.', shape: {},
    run: async (api) => (await api.get('/projects')).slice(0, 40).map((p) => ({ id: p.id, name: p.name, client: p.organization?.name, status: p.status, due: day(p.dueDate), tickets: p._count?.tickets })),
  },
];

export const toolByName = (n) => TOOLS.find((t) => t.name === n);
export const schemaOf = (t) => z.object(t.shape);
export const jsonSchemaOf = (t) => { const s = z.toJSONSchema(schemaOf(t)); delete s.$schema; return s; };
export const capJson = (v, n = 9000) => { const s = JSON.stringify(v ?? null); return s.length > n ? `${s.slice(0, n)}…[truncated]` : s; };

/** Validate + run one tool. Never throws: returns { ok, data | error }. */
export async function runTool(api, name, args) {
  const tool = toolByName(name);
  if (!tool) return { ok: false, error: `Unknown tool ${name}` };
  const parsed = schemaOf(tool).safeParse(args || {});
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` };
  try {
    return { ok: true, data: await tool.run(api, parsed.data) };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : `Failed: ${e.message}`, code: e.code };
  }
}
