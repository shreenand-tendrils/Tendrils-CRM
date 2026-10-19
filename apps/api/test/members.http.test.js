// Drives the REAL Express app (auth middleware, RBAC, routes, validators) against an in-memory Prisma double.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEV_LOGIN = 'true'; process.env.NODE_ENV = 'test'; process.env.AUTH_SECRET = 'test-secret-test-secret-test-secret';

const orgs = [{ id: 'int', name: 'Tendrils', type: 'INTERNAL', isActive: true }, { id: 'cli', name: 'Sofabed', type: 'CLIENT', isActive: true }];
const teams = [{ id: 't1', name: 'Dev', organizationId: 'int' }, { id: 't2', name: 'QA', organizationId: 'int' }];
const users = [], memberships = [], teamMembers = [], invitations = [], activity = [], msgs = [], reads = [], deliv = [], notes = [], rooms = [{ id: 'room1', type: 'GENERAL', name: 'General' }]; let seq = 0;
const addUser = (email, name, orgId, role) => { const u = { id: `u${++seq}`, email, name }; users.push(u); memberships.push({ id: `m${++seq}`, userId: u.id, organizationId: orgId, role, isActive: true }); return u; };
const root = addUser('root.demo@tendrils.io', 'Root', 'int', 'PLATFORM_ADMIN');
const mgr = addUser('maya.demo@tendrils.io', 'Maya', 'int', 'MANAGER');
const emp = addUser('dev.demo@tendrils.io', 'Dev', 'int', 'EMPLOYEE');
const cli = addUser('ann.demo@sofabed.test', 'Ann', 'cli', 'CLIENT_ADMIN');

const org = (id) => orgs.find((o) => o.id === id);
const shape = (m, inc = {}) => ({ ...m, ...(inc.user ? { user: users.find((u) => u.id === m.userId) } : {}), ...(inc.organization ? { organization: org(m.organizationId) } : {}),
  ...(inc.teamMemberships ? { teamMemberships: teamMembers.filter((t) => t.membershipId === m.id).map((t) => ({ ...t, team: teams.find((x) => x.id === t.teamId) })) } : {}) });
const inv = (i, inc) => (i && inc ? { ...i, organization: org(i.organizationId), invitedBy: users.find((u) => u.id === i.invitedById) || null } : i);

const db = {
  user: {
    findUnique: async ({ where }) => { const u = users.find((x) => (where.email ? x.email === where.email : x.id === where.id)); if (!u) return null;
      return { ...u, memberships: memberships.filter((m) => m.userId === u.id && m.isActive && org(m.organizationId).isActive).map((m) => shape(m, { organization: 1, teamMemberships: 1 })) }; },
    upsert: async ({ where, create }) => users.find((u) => u.email === where.email) || (users.push({ id: `u${++seq}`, ...create }), users.at(-1)),
    findMany: async ({ where }) => users.filter((u) => where.id.in.includes(u.id)),
  },
  chatRoom: { findUnique: async ({ where }) => rooms.find((r) => r.id === where.id) || null },
  chatMessage: {
    create: async ({ data, include }) => { const m = { id: `c${++seq}`, createdAt: new Date(), editedAt: null, deletedAt: null, pinnedAt: null, pinnedById: null, ...data }; msgs.push(m); return include ? { ...m, author: users.find((u) => u.id === m.authorId) } : m; },
    findUnique: async ({ where, include }) => { const m = msgs.find((x) => x.id === where.id); return m && include ? { ...m, author: users.find((u) => u.id === m.authorId) } : m || null; },
    update: async ({ where, data, include }) => { const m = Object.assign(msgs.find((x) => x.id === where.id), data); return include ? { ...m, author: users.find((u) => u.id === m.authorId) } : m; },
    findFirst: async ({ where }) => msgs.find((m) => m.id === where.id && m.roomId === where.roomId) || null,
    count: async ({ where }) => msgs.filter((m) => m.roomId === where.roomId && m.pinnedAt).length,
    findMany: async ({ where }) => msgs.filter((m) => m.roomId === where.roomId && (!where.pinnedAt || m.pinnedAt) && (where.deletedAt !== null || !m.deletedAt)).map((m) => ({ ...m, author: users.find((u) => u.id === m.authorId) })),
  },
  chatRead: {
    upsert: async ({ where, update, create }) => { const k = where.roomId_userId; const r = reads.find((x) => x.roomId === k.roomId && x.userId === k.userId); return r ? Object.assign(r, update) : (reads.push(create), create); },
    findMany: async ({ where }) => reads.filter((r) => r.roomId === where.roomId && where.userId.in.includes(r.userId)),
  },
  chatDelivery: { upsert: async () => null, findMany: async () => deliv },
  notification: { create: async ({ data }) => (notes.push(data), { id: `n${++seq}`, ...data }) },
  organization: { findUnique: async ({ where }) => org(where.id) || null },
  membership: {
    findFirst: async ({ where }) => { const m = memberships.find((x) => x.organizationId === where.organizationId && (where.isActive === undefined || x.isActive === where.isActive) && users.find((u) => u.id === x.userId).email === where.user.email); return m ? shape(m) : null; },
    findUnique: async ({ where, include }) => { const m = memberships.find((x) => x.id === where.id); return m ? shape(m, include) : null; },
    findMany: async ({ include, where }) => memberships.filter((m) => where?.isActive === undefined || m.isActive === where.isActive).filter((m) => !where?.role?.in || where.role.in.includes(m.role)).filter((m) => !where?.organization?.type || org(m.organizationId).type === where.organization.type).map((m) => shape(m, include)),
    count: async ({ where }) => memberships.filter((m) => m.role === where.role && m.isActive && m.userId !== where.userId.not).length,
    upsert: async ({ where, update, create }) => { const k = where.userId_organizationId; const m = memberships.find((x) => x.userId === k.userId && x.organizationId === k.organizationId); if (m) return Object.assign(m, update); memberships.push({ id: `m${++seq}`, isActive: true, ...create }); return memberships.at(-1); },
    update: async ({ where, data, include }) => shape(Object.assign(memberships.find((x) => x.id === where.id), data), include),
  },
  invitation: {
    findFirst: async ({ where }) => invitations.find((i) => i.email === where.email && i.organizationId === where.organizationId && i.status === where.status) || null,
    findUnique: async ({ where, include }) => inv(invitations.find((i) => i.id === where.id), include),
    findMany: async ({ where }) => invitations.filter((i) => i.status === where.status).map((i) => inv(i, true)),
    create: async ({ data, include }) => { invitations.push({ id: `i${++seq}`, status: 'PENDING', createdAt: new Date(), ...data }); return inv(invitations.at(-1), include); },
    update: async ({ where, data, include }) => inv(Object.assign(invitations.find((i) => i.id === where.id), data), include),
    updateMany: async ({ where, data }) => { for (const i of invitations) if (i.email === where.email && i.organizationId === where.organizationId && i.status === where.status) Object.assign(i, data); },
  },
  team: { count: async ({ where }) => teams.filter((t) => where.id.in.includes(t.id) && org(t.organizationId).type === 'INTERNAL').length },
  teamMember: {
    deleteMany: async ({ where }) => { for (let i = teamMembers.length - 1; i >= 0; i--) if (teamMembers[i].membershipId === where.membershipId) teamMembers.splice(i, 1); },
    createMany: async ({ data }) => { for (const d of data) if (!teamMembers.some((t) => t.teamId === d.teamId && t.membershipId === d.membershipId)) teamMembers.push(d); },
  },
  activityLog: { create: async ({ data }) => activity.push(data) },
  $transaction: async (fn) => fn(db),
};
globalThis.__PRISMA_TEST_DOUBLE__ = db;

const { createApp } = await import('../src/config/app.js');
const { signDevToken, DEV_COOKIE } = await import('../src/services/devAuth.js');
const server = createApp().listen(0);
const base = `http://localhost:${server.address().port}/api/v1`;
const call = async (as, method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(as ? { cookie: `${DEV_COOKIE}=${signDevToken(as.email)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
test.after(() => server.close());

test('access: anonymous 401, employee and client 403 on admin APIs', async () => {
  assert.equal((await call(null, 'GET', '/admin/members')).status, 401);
  for (const who of [emp, cli]) {
    assert.equal((await call(who, 'GET', '/admin/members')).status, 403);
    assert.equal((await call(who, 'POST', '/admin/invitations', { email: 'x@y.io', organizationId: 'int', role: 'EMPLOYEE' })).status, 403);
  }
  const list = await call(mgr, 'GET', '/admin/members');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.find((m) => m.user.email === emp.email).memberType, 'internal');
  assert.equal(list.body.find((m) => m.user.email === cli.email).memberType, 'client');
});

test('email invitation: lower-cased, any domain, multiple teams, re-invite refreshes (no duplicates)', async () => {
  const r = await call(mgr, 'POST', '/admin/invitations', { email: ' New.Hire@Gmail.com ', organizationId: 'int', role: 'EMPLOYEE', teamIds: ['t1', 't2'] });
  assert.equal(r.status, 201);
  assert.equal(r.body.email, 'new.hire@gmail.com'); assert.deepEqual(r.body.teamIds, ['t1', 't2']); assert.equal(r.body.memberType, 'internal');
  await call(mgr, 'POST', '/admin/invitations', { email: 'new.hire@gmail.com', organizationId: 'int', role: 'MANAGER', teamIds: ['t1'] });
  const pending = (await call(mgr, 'GET', '/admin/invitations')).body.filter((i) => i.email === 'new.hire@gmail.com');
  assert.equal(pending.length, 1); assert.equal(pending[0].role, 'MANAGER');
});

test('invitation guards: admin grant, role/workspace fit, teams internal-only, existing member', async () => {
  const bad = (body) => call(mgr, 'POST', '/admin/invitations', { organizationId: 'int', role: 'EMPLOYEE', ...body });
  assert.equal((await bad({ email: 'a@b.io', role: 'PLATFORM_ADMIN' })).status, 403, 'manager cannot grant Platform admin');
  assert.equal((await call(root, 'POST', '/admin/invitations', { email: 'boss@b.io', organizationId: 'int', role: 'PLATFORM_ADMIN' })).status, 201, 'platform admin can');
  assert.equal((await bad({ email: 'a@b.io', role: 'CLIENT_ADMIN' })).status, 400, 'client role in staff workspace');
  assert.equal((await bad({ email: 'a@b.io', organizationId: 'cli', role: 'MANAGER' })).status, 400, 'staff role in client workspace');
  const c = await bad({ email: 'a@b.io', organizationId: 'cli', role: 'CLIENT_MEMBER', teamIds: ['t1'] });
  assert.equal(c.status, 400); assert.match(c.body.error, /internal/i);
  assert.equal((await bad({ email: 'a@b.io', teamIds: ['ghost'] })).status, 400);
  assert.equal((await bad({ email: emp.email })).status, 409, 'already a member');
  assert.equal((await bad({ email: 'not-an-email' })).status, 400);
  assert.equal((await call(mgr, 'POST', '/admin/invitations', { email: 'ok@client.io', organizationId: 'cli', role: 'CLIENT_ADMIN' })).status, 201, 'client onboarding invite');
});

test('resend cooldown, revoke', async () => {
  const id = (await call(mgr, 'GET', '/admin/invitations')).body.find((i) => i.email === 'ok@client.io').id;
  assert.equal((await call(mgr, 'POST', `/admin/invitations/${id}/resend`)).status, 429);
  invitations.find((i) => i.id === id).lastSentAt = new Date(Date.now() - 120000);
  assert.equal((await call(mgr, 'POST', `/admin/invitations/${id}/resend`)).status, 200);
  assert.equal((await call(mgr, 'DELETE', `/admin/invitations/${id}`)).status, 200);
  assert.equal(invitations.find((i) => i.id === id).status, 'REVOKED');
  assert.equal((await call(mgr, 'POST', `/admin/invitations/${id}/resend`)).status, 404, 'revoked invitations cannot be reused');
});

test('manual provisioning with teams, then edit teams, role and deactivation', async () => {
  const r = await call(mgr, 'POST', '/admin/members', { email: 'Zed@Corp.io', name: 'Zed', organizationId: 'int', role: 'EMPLOYEE', teamIds: ['t1', 't2'], notify: false });
  assert.equal(r.status, 201); assert.deepEqual(r.body.teams.map((t) => t.id).sort(), ['t1', 't2']);
  const mid = r.body.id;
  const one = await call(mgr, 'PUT', `/admin/members/${mid}/teams`, { teamIds: ['t2'] });
  assert.deepEqual(one.body.teams.map((t) => t.id), ['t2']);
  assert.equal((await call(mgr, 'PUT', `/admin/members/${mid}/teams`, { teamIds: ['nope'] })).status, 400);
  const clientM = await call(mgr, 'POST', '/admin/members', { email: 'cm@client.io', organizationId: 'cli', role: 'CLIENT_MEMBER', notify: false });
  assert.equal(clientM.status, 201); assert.equal(clientM.body.memberType, 'client');
  assert.equal((await call(mgr, 'PUT', `/admin/members/${clientM.body.id}/teams`, { teamIds: ['t1'] })).status, 400, 'clients cannot join teams');
  assert.equal((await call(mgr, 'PATCH', `/admin/members/${mid}`, { isActive: false })).body.isActive, false);
  assert.equal((await call(mgr, 'PATCH', `/admin/members/${memberships.find((m) => m.userId === mgr.id).id}`, { role: 'EMPLOYEE' })).status, 403, 'cannot edit own access');
  assert.equal((await call(mgr, 'PATCH', `/admin/members/${memberships.find((m) => m.userId === root.id).id}`, { role: 'MANAGER' })).status, 403, 'manager cannot demote Platform admin');
});

test('a deactivated or unknown account has no access', async () => {
  const late = await call(mgr, 'POST', '/admin/members', { email: 'late.demo@corp.io', organizationId: 'int', role: 'EMPLOYEE', notify: false });
  const lateUser = users.find((u) => u.email === 'late.demo@corp.io');
  assert.equal((await call(lateUser, 'GET', '/me')).status, 200);
  await call(mgr, 'PATCH', `/admin/members/${late.body.id}`, { isActive: false });
  const gone = await call(lateUser, 'GET', '/me');
  assert.equal(gone.status, 403); assert.equal(gone.body.code, 'NO_MEMBERSHIP');
  assert.equal((await call({ email: 'ghost.demo@nowhere.test' }, 'GET', '/me')).status, 403);
  assert.equal((await call(emp, 'GET', '/me')).status, 200);
});

test('chat: @mention notifies, edit window, pin limit, delete-for-everyone, receipts, staff-only', async () => {
  const send = (as, body, mentionIds) => call(as, 'POST', '/chat/rooms/room1/messages', { body, mentionIds });
  const m1 = await send(emp, 'review please @Maya', [mgr.id, 'ghost', emp.id]);
  assert.equal(m1.status, 201); assert.deepEqual(m1.body.mentionIds, [mgr.id], 'only real participants, never yourself');
  assert.ok(notes.some((n) => n.userId === mgr.id && n.type === 'MENTION'), 'mentioned person is notified');
  assert.ok(!notes.some((n) => n.userId === emp.id), 'author is not notified');

  assert.equal((await call(mgr, 'PATCH', `/chat/messages/${m1.body.id}`, { body: 'hijack' })).status, 403, 'only the author edits');
  const edited = await call(emp, 'PATCH', `/chat/messages/${m1.body.id}`, { body: 'review please @Maya (updated)' });
  assert.equal(edited.status, 200); assert.ok(edited.body.editedAt);
  msgs.find((m) => m.id === m1.body.id).createdAt = new Date(Date.now() - 20 * 60 * 1000);
  assert.equal((await call(emp, 'PATCH', `/chat/messages/${m1.body.id}`, { body: 'too late' })).status, 403, '15-minute edit window');

  const ids = [];
  for (const t of ['a', 'b', 'c', 'd']) ids.push((await send(mgr, t)).body.id);
  for (const id of ids.slice(0, 3)) assert.equal((await call(emp, 'PUT', `/chat/messages/${id}/pin`)).status, 200);
  const over = await call(emp, 'PUT', `/chat/messages/${ids[3]}/pin`);
  assert.equal(over.status, 400); assert.equal(over.body.code, 'PIN_LIMIT');
  assert.equal((await call(emp, 'GET', '/chat/rooms/room1/pins')).body.length, 3);
  assert.equal((await call(emp, 'DELETE', `/chat/messages/${ids[0]}/pin`)).body.pinnedAt, null);

  assert.equal((await call(emp, 'DELETE', `/chat/messages/${ids[1]}`)).status, 403, 'employees cannot delete others');
  const gone = await call(mgr, 'DELETE', `/chat/messages/${ids[1]}`);
  assert.equal(gone.body.body, ''); assert.ok(gone.body.deletedAt);
  assert.equal((await call(emp, 'PUT', `/chat/messages/${ids[1]}/pin`)).status, 400, 'deleted messages cannot be pinned');

  const last = await send(emp, 'any update?');
  const mark = async () => new Date((await call(emp, 'GET', '/chat/rooms/room1/receipts')).body.find((r) => r.userId === mgr.id).readAt).getTime();
  assert.ok((await mark()) < new Date(last.body.createdAt).getTime(), 'not read yet -> single/double grey tick');
  await call(mgr, 'POST', '/chat/rooms/room1/read');
  assert.ok((await mark()) >= new Date(last.body.createdAt).getTime(), 'read receipt recorded -> blue ticks');

  assert.equal((await call(cli, 'GET', '/chat/rooms/room1/messages')).status, 403, 'clients have no chat');
});

test('chat: reply, @all rules, message info (sender only)', async () => {
  const send = (as, body, extra = {}) => call(as, 'POST', '/chat/rooms/room1/messages', { body, ...extra });
  const base = await send(emp, 'deploy at 6?');
  const rep = await send(mgr, 'yes, go ahead', { replyToId: base.body.id });
  assert.equal(rep.status, 201); assert.equal(rep.body.replyToId, base.body.id);
  assert.equal((await send(mgr, 'x', { replyToId: 'nope' })).status, 400, 'reply target must exist in this room');

  const before = notes.length;
  const denied = await send(emp, 'hey @all standup now');
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'MENTION_ALL_DENIED');
  const ok = await send(mgr, 'Team, @everyone please read');
  assert.equal(ok.status, 201);
  const pinged = notes.slice(before).filter((n) => n.type === 'MENTION').map((n) => n.userId).sort();
  assert.deepEqual(pinged, [emp.id, root.id].sort(), '@all notifies every other staff member, not the sender or clients');
  assert.match(notes.at(-1).title, /mentioned everyone/);

  assert.equal((await call(mgr, 'GET', `/chat/messages/${base.body.id}/info`)).status, 403, 'only the sender sees info');
  deliv.push({ roomId: 'room1', userId: root.id, deliveredAt: new Date(Date.now() + 1000) });
  const last = await send(emp, 'info please');
  const reads2 = reads.find((r) => r.userId === mgr.id); reads2.lastReadAt = new Date(Date.now() + 5000);
  const info = (await call(emp, 'GET', `/chat/messages/${last.body.id}/info`)).body;
  assert.deepEqual(info.readBy.map((x) => x.user.id), [mgr.id]);
  assert.deepEqual(info.deliveredTo.map((x) => x.user.id), [root.id]);
  assert.equal(info.pending.length, 0);
});

test('activity visibility: audit for admins, work feed for staff, curated timeline for clients', async () => {
  const { activityScope } = await import('../src/middleware/index.js');
  const ctx = (u) => { const ms = memberships.filter((m) => m.userId === u.id).map((m) => ({ ...m, organization: org(m.organizationId) })); const internal = ms.some((m) => m.organization.type === 'INTERNAL');
    const perms = new Set(internal ? (u === root || u === mgr ? ['admin.view'] : []) : []); return { currentUser: u, memberships: ms, isInternal: internal, can: (p) => perms.has(p) }; };
  assert.deepEqual(activityScope(ctx(root)), {}, 'admins see the full audit log');
  assert.deepEqual(activityScope(ctx(emp)), { entityType: { not: 'access' } }, 'staff never see access events');
  const c = activityScope(ctx(cli));
  assert.deepEqual(c.organizationId, { in: ['cli'] });
  assert.equal(JSON.stringify(c).includes('organization"'), false);
  assert.ok(!JSON.stringify(c.OR).includes("access") && !JSON.stringify(c.OR).includes("task") && !JSON.stringify(c.OR).includes("team"));
  // the invite/role-change logs written earlier in this file are tagged 'access'
  assert.ok(activity.some((a) => a.entityType === 'access') && !activity.some((a) => a.entityType === 'organization' && a.action === 'updated'));
});
