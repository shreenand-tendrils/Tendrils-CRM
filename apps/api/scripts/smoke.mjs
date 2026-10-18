// End-to-end check of roles, tenant isolation, chat, DMs, notifications and the admin console.
// Needs: API running with DEV_LOGIN=true, and `npm run seed:demo` done.   Run: npm run smoke
import WebSocket from 'ws';

const API = process.env.API_URL || 'http://localhost:4000';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : extra ? ` -> ${extra}` : ''}`); };
const section = (t) => console.log(`\n${t}`);

async function persona(email) {
  const r = await fetch(`${API}/api/v1/dev/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error(`dev login failed for ${email}: ${r.status} ${await r.text()} (is DEV_LOGIN=true and seed:demo done?)`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const call = async (method, path, body) => {
    const res = await fetch(`${API}/api/v1${path}`, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { email, cookie, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b), put: (p, b) => call('PUT', p, b) };
}

function openWs(p) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${API.replace('http', 'ws')}/ws`, { headers: { cookie: p.cookie } });
    ws.events = [];
    ws.on('message', (d) => ws.events.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve(ws));
    ws.on('unexpected-response', (_q, res) => reject(new Error(`ws rejected ${res.statusCode}`)));
    ws.on('error', reject);
  });
}
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return null; };

const maya = await persona('maya.demo@tendrils.io');
const dev = await persona('dev.demo@tendrils.io');
const isha = await persona('isha.demo@tendrils.io');
const sofa = await persona('sofabed.demo@sofabed.test');
const jenni = await persona('jennihome.demo@jennihome.test');
const tara = await persona('tara.demo@tendrils.io');
const root = await persona('root.demo@tendrils.io');
const boss = await persona('boss.demo@sofabed.test');

section('Identity & roles');
const mMe = (await maya.get('/me')).data, dMe = (await dev.get('/me')).data, sMe = (await sofa.get('/me')).data;
check('manager: isInternal + isManager', mMe.isInternal && mMe.isManager);
check('employee: internal, not manager', dMe.isInternal && !dMe.isManager);
check('client: not internal, not manager', !sMe.isInternal && !sMe.isManager);

section('Client isolation (Sofabed client)');
const sTickets = (await sofa.get('/tickets')).data;
check('sees own client-visible ticket', sTickets.some((t) => t.key === 'SOF-100001'));
check('does NOT see internal ticket', !sTickets.some((t) => t.key === 'SOF-100002'));
check('does NOT see other client ticket', !sTickets.some((t) => t.key.startsWith('JEN')));
check('projects limited to own client', (await sofa.get('/projects')).data.every((p) => p.organization.name === 'Sofabed'));
check('project list has no staff members/chat', (await sofa.get('/projects')).data.every((p) => !p.members && !p.chatRoom));
check('tasks list empty for client', (await sofa.get('/tasks')).data.length === 0);
check('cannot create task (403)', (await sofa.post('/tasks', { title: 'x task', organizationId: sMe.memberships[0].organization.id })).status === 403);
check('cannot create project (403)', (await sofa.post('/projects', { name: 'Nope', organizationId: sMe.memberships[0].organization.id })).status === 403);
check('chat blocked (403)', (await sofa.get('/chat/rooms')).status === 403);
check('daily updates blocked (403)', (await sofa.post('/updates', { yesterday: 'aa', today: 'bb' })).status === 403);
check('admin console blocked (403)', (await sofa.get('/admin/overview')).status === 403);
check('users directory blocked (403)', (await sofa.get('/users')).status === 403);
const sAct = (await sofa.get('/activity')).data;
check('activity has no tasks/updates/internal tickets', sAct.every((a) => ['project', 'organization', 'ticket'].includes(a.entityType)) && !sAct.some((a) => a.summary.includes('INTERNAL')));
const internalTicket = (await maya.get('/tickets')).data.find((t) => t.key === 'SOF-100002');
check('cannot open internal ticket comments (404)', (await sofa.get(`/tickets/${internalTicket.id}/comments`)).status === 404);
const sd = (await sofa.get('/dashboard')).data.metrics;
check('dashboard: no task counts for client', sd.tasks === 0 && sd.overdue === 0);
const jTicket = (await jenni.get('/tickets')).data.find((t) => t.key === 'JEN-100001');
check('client A cannot read client B ticket (404)', (await sofa.get(`/tickets/${jTicket.id}/comments`)).status === 404);

section('Client can raise a ticket');
const newT = await sofa.post('/tickets', { title: `Smoke ticket ${Date.now()}`, organizationId: sMe.memberships[0].organization.id });
check('client creates ticket', newT.status === 201);
check('client cannot make it internal (403)', (await sofa.post('/tickets', { title: 'Sneaky one', organizationId: sMe.memberships[0].organization.id, visibility: 'INTERNAL' })).status === 403);
check('client cannot change status (403)', (await sofa.patch(`/tickets/${newT.data.id}`, { status: 'CLOSED' })).status === 403);
check('client comment is client-visible', (await sofa.post(`/tickets/${newT.data.id}/comments`, { body: 'hello', visibility: 'CLIENT' })).status === 201);
check('client cannot post internal comment (403)', (await sofa.post(`/tickets/${newT.data.id}/comments`, { body: 'x', visibility: 'INTERNAL' })).status === 403);

section('Staff: multi-assignee task + notifications');
const sofaOrg = (await maya.get('/organizations')).data.find((o) => o.slug === 'sofabed');
const devWs = await openWs(dev), ishaWs = await openWs(isha);
const t = await maya.post('/tasks', { title: `Smoke task ${Date.now()}`, organizationId: sofaOrg.id, assigneeIds: [dMe.user.id, (await isha.get('/me')).data.user.id], dueDate: '2026-12-31' });
check('multi-assignee task created with YYYY-MM-DD date', t.status === 201);
const mine = (await dev.get('/tasks?mine=true')).data;
check('both assignees see it under "mine"', mine.some((x) => x.id === t.data.id) && (await isha.get('/tasks?mine=true')).data.some((x) => x.id === t.data.id));
check('task lists 2 assignees', (await maya.get('/tasks')).data.find((x) => x.id === t.data.id)?.assignees.length === 2);
check('assignee gets LIVE notification over WebSocket', !!(await waitFor(() => devWs.events.find((e) => e.type === 'notification'))));
check('notification saved in DB', (await dev.get('/notifications')).data.some((n) => n.type === 'ASSIGNMENT'));
check('reject non-staff assignee (400)', (await maya.post('/tasks', { title: 'Bad one', organizationId: sofaOrg.id, assigneeIds: [sMe.user.id] })).status === 400);
check('read-all notifications', (await dev.post('/notifications/read-all')).status === 200);

section('Projects & teams');
const projects = (await maya.get('/projects')).data;
const web = projects.find((p) => p.name === 'Website Revamp');
check('staff see members + chat room on projects', web.members.length === 3 && !!web.chatRoom);
check('employee (not lead) cannot edit team (403)', (await dev.put(`/projects/${web.id}/members`, { memberIds: [dMe.user.id] })).status === 403);
check('manager can edit team', (await maya.put(`/projects/${web.id}/members`, { memberIds: web.members.map((m) => m.userId), leadId: mMe.user.id })).status === 200);

section('Chat: rooms, WebSocket, DMs, unread');
const rooms = (await dev.get('/chat/rooms')).data;
const general = rooms.find((r) => r.type === 'GENERAL');
check('staff see General + project room', !!general && rooms.some((r) => r.type === 'PROJECT'));
check('non-member does not see other project room', !(await dev.get('/chat/rooms')).data.some((r) => r.name === 'JenniHome SEO'));
check('manager sees every project room', (await maya.get('/chat/rooms')).data.some((r) => r.name === 'JenniHome SEO'));
const seoRoom = (await maya.get('/chat/rooms')).data.find((r) => r.name === 'JenniHome SEO');
check('non-member cannot read project room (404)', (await dev.get(`/chat/rooms/${seoRoom.id}/messages`)).status === 404);
check('non-member cannot post to project room (404)', (await dev.post(`/chat/rooms/${seoRoom.id}/messages`, { body: 'hi' })).status === 404);

const mayaWs = await openWs(maya);
check('presence: ready lists online staff', (await waitFor(() => mayaWs.events.find((e) => e.type === 'ready')))?.online.length >= 2);
const text = `hello team ${Date.now()}`;
devWs.send(JSON.stringify({ type: 'chat.send', roomId: general.id, body: text, tempId: 't1' }));
check('sender gets ack', !!(await waitFor(() => devWs.events.find((e) => e.type === 'chat.ack' && e.tempId === 't1'))));
check('other staff receive message LIVE', !!(await waitFor(() => mayaWs.events.find((e) => e.type === 'chat.message' && e.message.body === text))));
check('message persisted (REST history)', (await isha.get(`/chat/rooms/${general.id}/messages`)).data.some((m) => m.body === text));
check('recipient has unread badge', (await isha.get('/chat/unread')).data.total >= 1);
await isha.post(`/chat/rooms/${general.id}/read`);
check('mark read clears General unread', (await isha.get('/chat/rooms')).data.find((r) => r.id === general.id).unread === 0);
devWs.send(JSON.stringify({ type: 'chat.send', roomId: general.id, body: '   ', tempId: 'bad' }));
check('empty message rejected', !!(await waitFor(() => devWs.events.find((e) => e.type === 'chat.error' && e.tempId === 'bad'))));
devWs.send(JSON.stringify({ type: 'chat.typing', roomId: general.id }));
check('typing indicator delivered', !!(await waitFor(() => mayaWs.events.find((e) => e.type === 'chat.typing'))));

const dm = await dev.post('/chat/dm', { userId: (await isha.get('/me')).data.user.id });
check('create DM', dm.status === 201);
check('DM is idempotent (same room both ways)', (await isha.post('/chat/dm', { userId: dMe.user.id })).data.id === dm.data.id);
const dmText = `private ${Date.now()}`;
devWs.send(JSON.stringify({ type: 'chat.send', roomId: dm.data.id, body: dmText, tempId: 'd1' }));
check('DM delivered live to recipient only', !!(await waitFor(() => ishaWs.events.find((e) => e.type === 'chat.message' && e.message.body === dmText))));
await new Promise((r) => setTimeout(r, 300));
check('third person did NOT receive the DM', !mayaWs.events.some((e) => e.message?.body === dmText));
check('third person cannot read DM (404)', (await maya.get(`/chat/rooms/${dm.data.id}/messages`)).status === 404);
check('DM shows other person as room name', (await isha.get('/chat/rooms')).data.find((r) => r.id === dm.data.id)?.name === 'Dev Rao');
check('cannot DM yourself (400)', (await dev.post('/chat/dm', { userId: dMe.user.id })).status === 400);
check('cannot DM a client (400)', (await dev.post('/chat/dm', { userId: sMe.user.id })).status === 400);

section('WebSocket security');
await new Promise((r) => { const w = new WebSocket(`${API.replace('http', 'ws')}/ws`); w.on('unexpected-response', (_q, res) => { check('no cookie -> 401', res.statusCode === 401); r(); }); w.on('error', () => r()); });
await new Promise((r) => { const w = new WebSocket(`${API.replace('http', 'ws')}/ws`, { headers: { cookie: maya.cookie, origin: 'http://evil.example' } }); w.on('unexpected-response', (_q, res) => { check('foreign Origin -> 403', res.statusCode === 403); r(); }); w.on('error', () => r()); });
const clientWs = await openWs(sofa);
check('client may connect (notifications only)', !!(await waitFor(() => clientWs.events.find((e) => e.type === 'ready'))));
clientWs.send(JSON.stringify({ type: 'chat.send', roomId: general.id, body: 'sneak', tempId: 'c1' }));
check('client cannot chat over WebSocket', !!(await waitFor(() => clientWs.events.find((e) => e.type === 'chat.error'))));
check('client never sees staff presence/online list', clientWs.events.find((e) => e.type === 'ready').online.length === 0);

section('Daily updates & admin console');
const day = new Date().toISOString().slice(0, 10);
const ud = await dev.post('/updates', { date: day, yesterday: 'Smoke: did things', today: 'Smoke: more things', blockers: '' });
check('employee posts daily update', [200, 201].includes(ud.status));
check('invalid/far-past date rejected (400)', (await dev.post('/updates', { date: '2020-01-01', yesterday: 'aa', today: 'bb' })).status === 400);
check('admin got in-app notification', !!(await waitFor(() => mayaWs.events.find((e) => e.type === 'notification' && e.notification.title.startsWith('Daily update')))));
const ov = (await maya.get(`/admin/overview?date=${day}`)).data;
check('admin overview lists the update', ov.updates.some((u) => u.user.email === 'dev.demo@tendrils.io'));
check('admin overview lists missing people', ov.missing.some((u) => u.email === 'isha.demo@tendrils.io'));
check('admin overview workload counts', ov.workload.find((w) => w.email === 'dev.demo@tendrils.io').open >= 1);
check('employee blocked from admin console (403)', (await dev.get('/admin/overview')).status === 403);
check('employee sees own history', (await dev.get('/updates/mine')).data.length >= 1);
check('activity log recorded the update (admin view)', (await maya.get('/activity')).data.some((a) => a.entityType === 'update'));

section('Dates (the original bug)');
for (const dueDate of ['2026-12-31', '2026-12-31T10:00:00.000Z']) {
  check(`task dueDate ${dueDate}`, (await maya.post('/tasks', { title: 'Date check', organizationId: sofaOrg.id, dueDate })).status === 201);
  check(`ticket dueDate ${dueDate}`, (await maya.post('/tickets', { title: 'Date check', organizationId: sofaOrg.id, dueDate })).status === 201);
  check(`project dueDate ${dueDate}`, (await maya.post('/projects', { name: `Date check ${Date.now()}`, organizationId: sofaOrg.id, dueDate })).status === 201);
}
check('impossible date 2026-02-31 rejected', (await maya.post('/tasks', { title: 'Date check', organizationId: sofaOrg.id, dueDate: '2026-02-31' })).status === 400);


section('RBAC: roles and permissions');
const rMe = (await root.get('/me')).data, tMe = (await tara.get('/me')).data, iMe = (await isha.get('/me')).data;
check('/me exposes permissions per role', mMe.permissions.includes('admin.view') && !dMe.permissions.includes('admin.view') && !sMe.permissions.includes('task.create') && sMe.permissions.includes('ticket.create'));
check('only Platform admin holds member.grant_admin', rMe.permissions.includes('member.grant_admin') && !mMe.permissions.includes('member.grant_admin'));
check('employee cannot create project (403)', (await dev.post('/projects', { name: 'Nope proj', organizationId: sofaOrg.id })).status === 403);
check('team lead can create project', (await tara.post('/projects', { name: `Lead proj ${Date.now()}`, organizationId: sofaOrg.id })).status === 201);
check('employee cannot create team (403)', (await dev.post('/teams', { name: 'Nope', slug: 'nope', organizationId: mMe.memberships[0].organization.id })).status === 403);
check('team lead cannot create team (403)', (await tara.post('/teams', { name: 'Nope', slug: 'nope', organizationId: mMe.memberships[0].organization.id })).status === 403);
check('employee cannot create client workspace (403)', (await dev.post('/organizations', { name: 'Nope Co', slug: 'nope-co' })).status === 403);
check('manager can create client workspace', (await maya.post('/organizations', { name: 'Smoke Co', slug: `smoke-${Date.now()}` })).status === 201);
check('team lead cannot open admin console (403)', (await tara.get('/admin/overview')).status === 403);
check('employee cannot list members (403)', (await dev.get('/admin/members')).status === 403);

section('RBAC: task rules');
const mine1 = await dev.post('/tasks', { title: `Dev own task ${Date.now()}`, organizationId: sofaOrg.id });
check('employee creates task; defaults to self', mine1.status === 201 && (await dev.get('/tasks')).data.find((x) => x.id === mine1.data.id)?.assignees[0]?.user.id === dMe.user.id);
check('employee cannot assign others (403)', (await dev.post('/tasks', { title: 'Assign other', organizationId: sofaOrg.id, assigneeIds: [iMe.user.id] })).status === 403);
const ishaTask = await maya.post('/tasks', { title: `Isha task ${Date.now()}`, organizationId: sofaOrg.id, assigneeIds: [iMe.user.id] });
check("employee cannot edit someone else's task (403)", (await dev.patch(`/tasks/${ishaTask.data.id}`, { status: 'DONE' })).status === 403);
check('employee can update own task status', (await dev.patch(`/tasks/${mine1.data.id}`, { status: 'IN_PROGRESS' })).status === 200);
check('employee cannot reassign even own task (403)', (await dev.patch(`/tasks/${mine1.data.id}`, { assigneeIds: [iMe.user.id] })).status === 403);
check('team lead can edit and reassign any task', (await tara.patch(`/tasks/${ishaTask.data.id}`, { priority: 'LOW', assigneeIds: [iMe.user.id, dMe.user.id] })).status === 200);

section('RBAC: tickets');
const plain = await maya.post('/tickets', { title: `Plain ticket ${Date.now()}`, organizationId: sofaOrg.id });
check('employee cannot edit a ticket not assigned to them (403)', (await dev.patch(`/tickets/${plain.data.id}`, { status: 'TRIAGED' })).status === 403);
check('employee cannot assign tickets to others (403)', (await dev.post('/tickets', { title: 'Assign other', organizationId: sofaOrg.id, assigneeId: iMe.user.id })).status === 403);
check('team lead (triage) can assign a ticket', (await tara.patch(`/tickets/${plain.data.id}`, { assigneeId: dMe.user.id })).status === 200);
check('assignee may change status only', (await dev.patch(`/tickets/${plain.data.id}`, { status: 'IN_PROGRESS' })).status === 200 && (await dev.patch(`/tickets/${plain.data.id}`, { title: 'Hijack title' })).status === 403);
const memberSees = (await sofa.get('/tickets')).data.map((t) => t.key), bossSees = (await boss.get('/tickets')).data.map((t) => t.key);
check('client MEMBER only sees tickets they raised', memberSees.includes('SOF-100001') && !memberSees.includes('SOF-100003'));
check('client ADMIN sees all client-visible tickets of the org', bossSees.includes('SOF-100001') && bossSees.includes('SOF-100003') && !bossSees.includes('SOF-100002'));
const t3 = (await boss.get('/tickets')).data.find((t) => t.key === 'SOF-100003');
check("client member cannot open a colleague's ticket (404)", (await sofa.get(`/tickets/${t3.id}/comments`)).status === 404);
check("client member's activity feed hides colleague tickets", !(await sofa.get('/activity')).data.some((a) => a.summary.includes('SOF-100003')) && (await boss.get('/activity')).data.some((a) => a.summary.includes('SOF-100003')));

section('Ticket -> task automation');
const tk = await maya.post('/tickets', { title: `Auto task ticket ${Date.now()}`, organizationId: sofaOrg.id, assigneeId: dMe.user.id, priority: 'HIGH', dueDate: '2026-12-01' });
const taskOf = async (ticketId) => (await maya.get('/tasks')).data.filter((x) => x.ticketId === ticketId);
let [auto] = await taskOf(tk.data.id);
check('assigned ticket auto-creates a task', tk.status === 201 && !!auto && auto.autoCreated);
check('task title carries the ticket key', auto?.title.startsWith(`[${tk.data.key}]`));
check('task copies assignee, priority, due date, status', auto?.assignees.length === 1 && auto.assignees[0].user.id === dMe.user.id && auto.priority === 'HIGH' && auto.dueDate?.startsWith('2026-12-01') && auto.status === 'TODO');
check('assignee finds it under "my tasks"', (await dev.get('/tasks?mine=true')).data.some((x) => x.id === auto.id));
check('staff ticket list shows the linked task', (await maya.get('/tickets')).data.find((t) => t.id === tk.data.id)?.tasks?.length === 1);
check('assignee got a ticket notification', (await dev.get('/notifications')).data.some((n) => n.title.includes(tk.data.key)));
await maya.patch(`/tickets/${tk.data.id}`, { assigneeId: iMe.user.id });
[auto] = await taskOf(tk.data.id);
check('reassigning the ticket moves the task to the new person', auto.assignees.length === 1 && auto.assignees[0].user.id === iMe.user.id && (await taskOf(tk.data.id)).length === 1);
await isha.patch(`/tasks/${auto.id}`, { status: 'IN_PROGRESS' });
check('task -> IN_PROGRESS moves the ticket to IN_PROGRESS', (await maya.get('/tickets')).data.find((t) => t.id === tk.data.id).status === 'IN_PROGRESS');
await isha.patch(`/tasks/${auto.id}`, { status: 'DONE' });
check('task DONE resolves the ticket', (await maya.get('/tickets')).data.find((t) => t.id === tk.data.id).status === 'RESOLVED');
await maya.patch(`/tickets/${tk.data.id}`, { status: 'OPEN' });
check('re-opening the ticket re-opens the task', (await taskOf(tk.data.id))[0].status === 'TODO');
await maya.patch(`/tickets/${tk.data.id}`, { status: 'CLOSED' });
check('closing the ticket completes the task', (await taskOf(tk.data.id))[0].status === 'DONE');
await maya.patch(`/tickets/${tk.data.id}`, { title: 'Renamed ticket', priority: 'LOW' });
auto = (await taskOf(tk.data.id))[0];
check('ticket title/priority edits flow to the task', auto.title === `[${tk.data.key}] Renamed ticket` && auto.priority === 'LOW');
const late = await maya.post('/tickets', { title: `Assigned later ${Date.now()}`, organizationId: sofaOrg.id });
check('unassigned ticket creates no task yet', (await taskOf(late.data.id)).length === 0);
await maya.patch(`/tickets/${late.data.id}`, { assigneeId: dMe.user.id });
await maya.patch(`/tickets/${late.data.id}`, { priority: 'URGENT' });
check('assigning later creates exactly one task (no duplicates)', (await taskOf(late.data.id)).length === 1);
await maya.patch(`/tickets/${late.data.id}`, { assigneeId: null });
check('unassigning the ticket unassigns the task', (await taskOf(late.data.id))[0].assignees.length === 0);
check('clients never see the linked task field', (await boss.get('/tickets')).data.every((t) => t.tasks === undefined));

section('People & access (admin)');
const orgs = (await maya.get('/organizations')).data, tendrilsOrg = orgs.find((o) => o.type === 'INTERNAL');
const members = (await maya.get('/admin/members')).data;
check('manager lists members', members.length >= 8);
check('role matrix endpoint', (await maya.get('/admin/rbac')).data.roles.length === 6);
const email = `smoke${Date.now()}@tendrils.io`;
const inv = await maya.post('/admin/members', { email, name: 'Smoke User', organizationId: tendrilsOrg.id, role: 'EMPLOYEE' });
check('manager invites a staff member', inv.status === 201);
check('internal invite needs @tendrils.io (400)', (await maya.post('/admin/members', { email: 'x@gmail.com', organizationId: tendrilsOrg.id, role: 'EMPLOYEE' })).status === 400);
check('client role not allowed in internal workspace (400)', (await maya.post('/admin/members', { email: `c${Date.now()}@tendrils.io`, organizationId: tendrilsOrg.id, role: 'CLIENT_MEMBER' })).status === 400);
check('manager cannot grant Platform admin (403)', (await maya.post('/admin/members', { email: `a${Date.now()}@tendrils.io`, organizationId: tendrilsOrg.id, role: 'PLATFORM_ADMIN' })).status === 403);
const rootMembership = members.find((m) => m.user.email === 'root.demo@tendrils.io');
check('manager cannot change a Platform admin (403)', (await maya.patch(`/admin/members/${rootMembership.id}`, { role: 'EMPLOYEE' })).status === 403);
check('nobody can change their own access (403)', (await root.patch(`/admin/members/${rootMembership.id}`, { isActive: false })).status === 403);
check('manager changes a role', (await maya.patch(`/admin/members/${inv.data.id}`, { role: 'TEAM_LEAD' })).data.role === 'TEAM_LEAD');
check('platform admin grants Platform admin', (await root.post('/admin/members', { email: `adm${Date.now()}@tendrils.io`, organizationId: tendrilsOrg.id, role: 'PLATFORM_ADMIN' })).status === 201);
check('manager deactivates a member', (await maya.patch(`/admin/members/${inv.data.id}`, { isActive: false })).data.isActive === false);
check('employee cannot change roles (403)', (await dev.patch(`/admin/members/${inv.data.id}`, { role: 'MANAGER' })).status === 403);

for (const w of [devWs, ishaWs, mayaWs, clientWs]) w.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
