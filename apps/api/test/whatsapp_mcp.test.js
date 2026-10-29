// WhatsApp + MCP (v4.9.0). Runs the REAL Express app, MCP endpoint and bot against an in-memory Prisma double.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test'; process.env.AUTH_SECRET = 't'.repeat(40);
process.env.WHATSAPP_TOKEN = 'tok'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123'; process.env.WHATSAPP_APP_SECRET = 'appsecret';
process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me'; process.env.WHATSAPP_BUSINESS_NUMBER = '+91 99999 11111';

const DAY = 86400000;
const users = [{ id: 'u1', email: 'dev@tendrils.io', name: 'Dev Employee' }, { id: 'u2', email: 'ann@sofabed.test', name: 'Ann Client' }];
const orgs = { int: { id: 'int', name: 'Tendrils', type: 'INTERNAL', isActive: true }, cli: { id: 'cli', name: 'Sofabed', type: 'CLIENT', isActive: true } };
const memberships = [
  { id: 'm1', userId: 'u1', organizationId: 'int', role: 'EMPLOYEE', isActive: true, organization: orgs.int, teamMemberships: [{ teamId: 't1', team: { id: 't1', name: 'SEO' } }] },
  { id: 'm2', userId: 'u2', organizationId: 'cli', role: 'CLIENT_ADMIN', isActive: true, organization: orgs.cli, teamMemberships: [] },
];
const tokens = [], links = [], wamsgs = [];
let seq = 0;
const match = (row, where = {}) => Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'gt' in v ? row[k] > v.gt : row[k] === v));
globalThis.__PRISMA_TEST_DOUBLE__ = {
  user: { findUnique: async ({ where }) => { const u = users.find((x) => (where.id ? x.id === where.id : x.email === where.email)); return u ? { ...u, memberships: memberships.filter((m) => m.userId === u.id) } : null; } },
  apiToken: {
    findUnique: async ({ where }) => tokens.find((t) => t.tokenHash === where.tokenHash) || null,
    update: async ({ where, data }) => Object.assign(tokens.find((t) => t.id === where.id), data),
  },
  whatsAppLink: {
    findUnique: async ({ where }) => links.find((l) => (where.userId ? l.userId === where.userId : l.phone === where.phone)) || null,
    findFirst: async ({ where, include }) => { const l = links.find((x) => (where.status ? x.status === where.status : true) && (where.phone ? x.phone === where.phone : true) && (where.codeHash ? x.codeHash === where.codeHash && x.codeExpiresAt > new Date() : true)); return l && include ? { ...l, user: users.find((u) => u.id === l.userId) } : l || null; },
    upsert: async ({ where, create, update }) => { const l = links.find((x) => x.userId === where.userId); if (l) return Object.assign(l, update); const n = { id: `l${++seq}`, status: 'PENDING', notifyEnabled: true, notifyTypes: [], aiEnabled: true, context: null, ...create }; links.push(n); return n; },
    update: async ({ where, data }) => Object.assign(links.find((x) => x.id === where.id), data),
  },
  whatsAppMessage: {
    create: async ({ data }) => { if (data.waId && wamsgs.some((m) => m.waId === data.waId)) throw Object.assign(new Error('dup'), { code: 'P2002' }); const m = { id: `w${++seq}`, ...data }; wamsgs.push(m); return m; },
    updateMany: async ({ where, data }) => { wamsgs.filter((m) => m.waId === where.waId).forEach((m) => Object.assign(m, data)); return { count: 1 }; },
  },
  notification: { findMany: async () => [{ type: 'ASSIGNMENT', title: 'Assigned', body: 'x', createdAt: new Date(), readAt: null }] },
};

const { signInternal, verifyInternal, bindServer } = await import('../src/services/internalApi.js');
const { newToken, bearerOf, authenticateBearer } = await import('../src/services/pat.js');
const { verifySignature, parseWebhook, processWebhook, handleInbound } = await import('../src/services/whatsapp/inbound.js');
const { parseCommand, handleLinkedMessage } = await import('../src/services/whatsapp/bot.js');
const { startLink, extractCode, completeLink } = await import('../src/services/whatsapp/link.js');
const { deliverWhatsApp } = await import('../src/services/whatsapp/notify.js');
const { runAgent } = await import('../src/services/whatsapp/agent.js');
const { TOOLS, runTool } = await import('../src/agent/tools.js');
const { createApp } = await import('../src/config/app.js');

const server = createApp().listen(0);
bindServer(server);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test('internal token: valid, tampered and expired', () => {
  const t = signInternal('u1', 60, 1_000_000);
  assert.equal(verifyInternal(t, 1_000_000), 'u1');
  assert.equal(verifyInternal(t.replace('u1', 'u2'), 1_000_000), null);
  assert.equal(verifyInternal(t, 1_000_000 + 61_000), null);
  assert.equal(verifyInternal('garbage'), null);
});

test('forged internal header is ignored; a signed one acts as that user (same RBAC as the web app)', async () => {
  assert.equal((await fetch(`${base}/api/v1/me`, { headers: { 'x-tendrils-internal': 'u1.9999999999.forged' } })).status, 401);
  const ok = await fetch(`${base}/api/v1/me`, { headers: { 'x-tendrils-internal': signInternal('u1') } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).user.email, 'dev@tendrils.io');
  // an employee must NOT reach the admin console via the internal door
  assert.equal((await fetch(`${base}/api/v1/admin/whatsapp`, { headers: { 'x-tendrils-internal': signInternal('u1') } })).status, 403);
});

test('personal access tokens: hashed, revocable, expiring, read-only scope', async () => {
  const a = newToken(), b = newToken(), c = newToken();
  assert.match(a.raw, /^tdl_/); assert.notEqual(a.raw, b.raw);
  tokens.push({ id: 'k1', userId: 'u1', tokenHash: a.hash, scopes: [], revokedAt: null, expiresAt: null },
    { id: 'k2', userId: 'u1', tokenHash: b.hash, scopes: ['read'], revokedAt: new Date(), expiresAt: null },
    { id: 'k3', userId: 'u1', tokenHash: c.hash, scopes: ['read'], revokedAt: null, expiresAt: new Date(Date.now() + DAY) });
  assert.equal(bearerOf(`Bearer ${a.raw}`), a.raw);
  assert.deepEqual(await authenticateBearer(`Bearer ${a.raw}`), { userId: 'u1', tokenId: 'k1', readOnly: false });
  assert.equal(await authenticateBearer(`Bearer ${b.raw}`), null); // revoked
  assert.equal((await authenticateBearer(`Bearer ${c.raw}`)).readOnly, true);
  assert.equal(await authenticateBearer('Bearer nope'), null);
  globalThis.__TOK = { full: a.raw, ro: c.raw };
});

test('MCP endpoint: 401 without token; tools/list + tools/call over real HTTP; read-only token hides write tools', async () => {
  const { full, ro } = globalThis.__TOK;
  const rpc = (token, body) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', ...body }) });
  assert.equal((await rpc(null, { id: 1, method: 'tools/list' })).status, 401);
  const init = await rpc(full, { id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.serverInfo.name, 'tendrils');
  const names = (await (await rpc(full, { id: 2, method: 'tools/list' })).json()).result.tools.map((t) => t.name);
  assert.ok(names.includes('create_ticket') && names.includes('get_ticket'));
  const roNames = (await (await rpc(ro, { id: 2, method: 'tools/list' })).json()).result.tools.map((t) => t.name);
  assert.ok(roNames.includes('list_tickets') && !roNames.includes('create_ticket') && !roNames.includes('update_task'));
  const call = await (await rpc(full, { id: 3, method: 'tools/call', params: { name: 'whoami', arguments: {} } })).json();
  assert.match(call.result.content[0].text, /Dev Employee/);
  assert.equal((await fetch(`${base}/mcp`, { method: 'GET' })).status, 405);
});

test('webhook: handshake, signature required, statuses update the log', async () => {
  assert.equal(await (await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc`)).text(), 'abc');
  assert.equal((await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=abc`)).status, 403);
  const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.OUT1', status: 'delivered', recipient_id: '919800000001' }] } }] }] });
  wamsgs.push({ waId: 'wamid.OUT1', direction: 'OUT', status: 'sent' });
  const sig = `sha256=${crypto.createHmac('sha256', 'appsecret').update(body).digest('hex')}`;
  assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, body })).status, 401);
  assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
  assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body })).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(wamsgs.find((m) => m.waId === 'wamid.OUT1').status, 'delivered');
  assert.equal(verifySignature(Buffer.from(body), sig, 'appsecret'), true);
});

test('parseWebhook normalises text, button and image messages', () => {
  const { messages } = parseWebhook({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '919800000001', profile: { name: 'Dev' } }], messages: [
    { from: '919800000001', id: 'a', type: 'text', text: { body: 'tasks' } },
    { from: '919800000001', id: 'b', type: 'interactive', interactive: { button_reply: { id: 'yes', title: 'Yes' } } },
    { from: '919800000001', id: 'c', type: 'image', image: { id: 'm1', mime_type: 'image/png', caption: 'SOF-123456' } }] } }] }] });
  assert.equal(messages[0].text, 'tasks'); assert.equal(messages[1].buttonId, 'yes');
  assert.deepEqual(messages[2].media, { id: 'm1', mime: 'image/png', filename: undefined }); assert.equal(messages[2].caption, 'SOF-123456');
  assert.equal(messages[0].profileName, 'Dev');
});

test('command parser', () => {
  assert.deepEqual(parseCommand('  Tasks '), { cmd: 'tasks' });
  assert.deepEqual(parseCommand('done 2'), { cmd: 'taskstatus', ref: '2', status: 'DONE' });
  assert.equal(parseCommand('comment SOF-123456 please check').text, 'please check');
  assert.equal(parseCommand('reply 1 hello').clientVisible, true);
  assert.deepEqual(parseCommand('new: Fix header logo'), { cmd: 'new', title: 'Fix header logo' });
  assert.equal(parseCommand('changes 1 logo too small').text, 'logo too small');
  assert.equal(parseCommand('random sentence here'), null);
  assert.equal(parseCommand('cancel').cmd, 'no');
});

test('linking: code proves the number, expires, and cannot hijack another account', async () => {
  const { code } = await startLink('u1');
  assert.equal(extractCode(`link ${code.toLowerCase()}`), code);
  assert.equal((await completeLink('919800000001', 'TDL-WRONG1')).ok, false);
  const r = await completeLink('919800000001', code);
  assert.equal(r.ok, true); assert.equal(r.link.status, 'ACTIVE'); assert.equal(r.link.codeHash, null);
  assert.equal((await completeLink('919800000001', code)).ok, false); // single use
  const second = await startLink('u2');
  assert.equal((await completeLink('919800000001', second.code)).reason, 'taken');
});

const fakeApi = (routes) => ({ get: async (p, q) => routes.get?.(p, q), post: async (p, b) => routes.post?.(p, b), patch: async (p, b) => routes.patch?.(p, b) });
const collector = () => { const out = []; return { out, io: { say: async (t) => out.push(t), buttons: async (t) => out.push(`[buttons] ${t}`) } }; };

test('bot: tasks list -> "done 1" changes status through the API; numbers expire with context', async () => {
  const link = links.find((l) => l.userId === 'u1'); link.user = users[0]; link.context = null;
  const patched = [];
  const api = fakeApi({
    get: (p) => (p === '/tasks' ? [{ id: 'tk1', title: 'Fix menu', status: 'TODO', priority: 'HIGH', ticket: { key: 'SOF-111111' }, assignees: [], assignee: { name: 'Dev' } }] : p === '/me' ? { isInternal: true, permissions: ['file.upload'] } : null),
    patch: (p, b) => { patched.push([p, b]); return { id: 'tk1', title: 'Fix menu', status: b.status }; },
  });
  const c = collector();
  await handleLinkedMessage({ link, msg: { text: 'tasks' }, api, io: c.io });
  assert.match(c.out[0], /Fix menu/);
  await handleLinkedMessage({ link: links.find((l) => l.userId === 'u1'), msg: { text: 'done 1' }, api, io: c.io });
  assert.deepEqual(patched[0], ['/tasks/tk1', { status: 'DONE' }]);
  assert.match(c.out[1], /Done/i);
});

test('bot: unknown sender is told how to link, only once an hour; duplicate wamid is ignored', async () => {
  const sent = [];
  const deps = { sendText: async (to, t) => sent.push(t), noMarkRead: true };
  await handleInbound({ from: '911111111111', waId: 'w-x1', type: 'text', text: 'hello' }, deps);
  await handleInbound({ from: '911111111111', waId: 'w-x2', type: 'text', text: 'hello again' }, deps);
  assert.equal(sent.length, 1); assert.match(sent[0], /not linked/);
  assert.equal(await handleInbound({ from: '911111111111', waId: 'w-x1', type: 'text', text: 'hello' }, deps), 'duplicate');
});

test('outbound: in-window -> text, closed window -> template, type switched off -> skipped', async () => {
  const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url).includes('graph.facebook.com')) { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messages: [{ id: `wamid.${calls.length}` }] }), { status: 200 }); } return realFetch(url, init); };
  try {
    const link = links.find((l) => l.userId === 'u1');
    link.windowOpenUntil = new Date(Date.now() + 3600e3);
    assert.deepEqual(await deliverWhatsApp({ userId: 'u1', type: 'ASSIGNMENT', title: 'Assigned', body: 'SOF-1', href: '/?ticket=1' }), { sent: 'text' });
    assert.equal(calls[0].type, 'text'); assert.match(calls[0].text.body, /Assigned/);
    link.windowOpenUntil = new Date(Date.now() - 1000);
    assert.deepEqual(await deliverWhatsApp({ userId: 'u1', type: 'ASSIGNMENT', title: 'A\nB', body: 'x', href: '/' }), { skipped: 'window-closed-no-template' });
    process.env.WHATSAPP_TEMPLATE_NOTIFY = 'tendrils_update';
    assert.deepEqual(await deliverWhatsApp({ userId: 'u1', type: 'ASSIGNMENT', title: 'A\nB', body: 'x', href: '/' }), { sent: 'template' });
    assert.equal(calls.at(-1).template.components[0].parameters[0].text, 'A B'); // newlines are illegal in template params
    link.notifyTypes = ['MENTION'];
    assert.deepEqual(await deliverWhatsApp({ userId: 'u1', type: 'ASSIGNMENT', title: 't', body: 'b' }), { skipped: 'type-off' });
    link.notifyTypes = []; link.notifyEnabled = false;
    assert.deepEqual(await deliverWhatsApp({ userId: 'u1', type: 'ASSIGNMENT', title: 't', body: 'b' }), { skipped: 'not-linked' });
    link.notifyEnabled = true;
  } finally { globalThis.fetch = realFetch; delete process.env.WHATSAPP_TEMPLATE_NOTIFY; }
});

test('AI agent: runs read tools itself, but PARKS write tools for user confirmation', async () => {
  const api = fakeApi({ get: (p) => (p === '/dashboard' ? { metrics: { tickets: 4 } } : null) });
  let n = 0;
  const reads = await runAgent({ api, userName: 'Dev', isStaff: true, text: 'how many tickets?', call: async () => (++n === 1 ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'dashboard_summary', input: {} }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'You have 4 open tickets.' }] }) });
  assert.equal(reads.text, 'You have 4 open tickets.');
  const w = await runAgent({ api, userName: 'Dev', isStaff: true, text: 'close SOF-1', call: async () => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'Closing it.' }, { type: 'tool_use', id: 't2', name: 'update_ticket', input: { ticket: 'SOF-1', status: 'CLOSED' } }] }) });
  assert.equal(w.pending.tool, 'update_ticket'); assert.equal(w.pending.args.status, 'CLOSED');
});

test('tool registry: every tool has a description and valid input; bad input is rejected, API errors surface as text', async () => {
  for (const t of TOOLS) assert.ok(t.description.length > 15 && typeof t.run === 'function', t.name);
  assert.equal((await runTool(fakeApi({}), 'list_tickets', { limit: 999 })).ok, false);
  const denied = await runTool({ get: async () => { const { ApiError } = await import('../src/services/internalApi.js'); throw new ApiError(403, 'You cannot do that'); } }, 'list_teams', {});
  assert.deepEqual([denied.ok, denied.error], [false, 'You cannot do that']);
});
