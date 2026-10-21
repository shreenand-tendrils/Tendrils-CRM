import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attachRealtime } from '../src/realtime/server.js';
import { hub } from '../src/realtime/hub.js';
import { AppError } from '../src/errors/AppError.js';

const ctxFor = (id, internal = true) => ({ currentUser: { id, name: id }, isInternal: internal, memberships: [] });

async function boot() {
  const server = http.createServer();
  const handlers = {
    echo: async (_c, m, reply) => reply({ type: 'echoed', text: m.text }),
    boom: async () => { throw new AppError('nope', 400); },
  };
  attachRealtime(server, {
    handlers,
    allowedOrigins: ['http://localhost:5173'],
    rateLimit: { burst: 3, everyMs: 60000 },
    authenticate: async (req) => (req.headers['x-user'] ? ctxFor(req.headers['x-user'], req.headers['x-client'] !== '1') : null),
  });
  await new Promise((r) => server.listen(0, r));
  return { server, url: `ws://localhost:${server.address().port}/ws` };
}
const open = (url, headers = {}) => new Promise((res, rej) => { const ws = new WebSocket(url, { headers }); ws.msgs = []; ws.on('message', (d) => ws.msgs.push(JSON.parse(d))); ws.on('open', () => res(ws)); ws.on('unexpected-response', (_q, r) => rej(new Error(String(r.statusCode)))); ws.on('error', rej); });
const until = async (fn) => { for (let i = 0; i < 60; i++) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return null; };

test('websocket: auth, origin, handlers, errors, presence, rate limit', async () => {
  const { server, url } = await boot();
  await assert.rejects(open(url), /401/);
  await assert.rejects(open(url, { 'x-user': 'a', origin: 'http://evil.example' }), /403/);

  const a = await open(url, { 'x-user': 'a', origin: 'http://localhost:5173' });
  assert.equal((await until(() => a.msgs.find((m) => m.type === 'ready'))).userId, 'a');
  const b = await open(url, { 'x-user': 'b' });
  assert.ok(await until(() => a.msgs.find((m) => m.type === 'presence' && m.userId === 'b' && m.online)), 'a sees b online');
  const c = await open(url, { 'x-user': 'c', 'x-client': '1' });
  assert.deepEqual((await until(() => c.msgs.find((m) => m.type === 'ready'))).online, [], 'clients get no presence list');

  hub.sendToUsers(['a', 'b'], { type: 'x', n: 1 });
  assert.ok(await until(() => b.msgs.find((m) => m.type === 'x')));
  assert.ok(!c.msgs.some((m) => m.type === 'x'), 'non-recipient gets nothing');

  a.send(JSON.stringify({ type: 'echo', text: 'hi' }));
  assert.equal((await until(() => a.msgs.find((m) => m.type === 'echoed'))).text, 'hi');
  a.send(JSON.stringify({ type: 'boom' }));
  assert.equal((await until(() => a.msgs.find((m) => m.type === 'error' && m.error === 'nope'))).error, 'nope');
  a.send('not json');
  assert.ok(await until(() => a.msgs.find((m) => m.error === 'Invalid JSON')));
  a.send(JSON.stringify({ type: 'wat' }));
  assert.ok(await until(() => a.msgs.find((m) => /Unknown message type/.test(m.error || ''))));
  for (let i = 0; i < 3; i++) a.send(JSON.stringify({ type: 'echo', text: 'flood' })); // only 1 token left of the burst of 3
  assert.ok(await until(() => a.msgs.find((m) => m.error === 'You are sending too fast')));

  b.close();
  assert.ok(await until(() => a.msgs.find((m) => m.type === 'presence' && m.userId === 'b' && !m.online)), 'a sees b go offline');
  a.close(); c.close();
  server.close();
});
