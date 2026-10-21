import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeNote } from '../src/services/notes.js';

const today = new Date('2026-10-20T10:00:00Z');

test('a note needs text; whitespace-only is rejected', () => {
  assert.ok(normalizeNote({ body: '   ' }, { today }).error);
  assert.ok(normalizeNote({}, { today }).error);
  assert.equal(normalizeNote({ body: '  hello  ' }, { today }).value.body, 'hello');
});

test('date defaults to today, accepts past days, rejects bad or far-future dates', () => {
  assert.equal(normalizeNote({ body: 'x' }, { today }).value.date.toISOString().slice(0, 10), '2026-10-20');
  assert.equal(normalizeNote({ body: 'x', date: '2026-09-01' }, { today }).value.date.toISOString().slice(0, 10), '2026-09-01');
  assert.ok(normalizeNote({ body: 'x', date: '20-10-2026' }, { today }).error);
  assert.ok(normalizeNote({ body: 'x', date: '2026-02-31x' }, { today }).error);
  assert.ok(normalizeNote({ body: 'x', date: '2026-12-31' }, { today }).error);
});

test('title is optional, trimmed, and capped', () => {
  assert.equal(normalizeNote({ body: 'x', title: '  Plan  ' }, { today }).value.title, 'Plan');
  assert.equal(normalizeNote({ body: 'x', title: '   ' }, { today }).value.title, null);
  assert.ok(normalizeNote({ body: 'x', title: 'a'.repeat(121) }, { today }).error);
  assert.ok(normalizeNote({ body: 'a'.repeat(10001) }, { today }).error);
});

test('PATCH only validates what is sent', () => {
  assert.deepEqual(normalizeNote({ title: 'New' }, { partial: true, today }).value, { title: 'New' });
  assert.ok(normalizeNote({ body: '' }, { partial: true, today }).error);
  assert.deepEqual(Object.keys(normalizeNote({}, { partial: true, today }).value), []);
});

// Guardrail for "only me, no mail, nothing": the notes route must stay isolated.
const src = fs.readFileSync(new URL('../src/routes/notes.routes.js', import.meta.url), 'utf8');

test('notes route never emails, notifies or writes to the activity log', () => {
  assert.ok(!/logActivity|notifyUser|notifyPeople|notifyAssignment|sendInviteEmail|sendDailyUpdateEmail|email\.service|activity\.js|notify\.service|fireAndLog/.test(src));
});

test('every notes query is scoped to the signed-in author', () => {
  const calls = src.match(/prisma\.privateNote\.\w+\(/g) || [];
  assert.ok(calls.length >= 5);
  assert.ok(!/privateNote\.(update|delete|findUnique|findMany|findFirst)\(\{\s*where:\s*\{\s*id/.test(src), 'no query may filter by id alone');
  assert.equal((src.match(/mineWhere\(req/g) || []).length >= 4, true);
  assert.ok(/userId: req\.currentUser\.id/.test(src));
});

test('no other route reads private notes (no admin/manager access)', () => {
  const dir = new URL('../src/', import.meta.url);
  const walk = (p) => fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, p)) : [new URL(e.name, p)]));
  const readers = walk(dir).filter((f) => f.pathname.endsWith('.js') && /privateNote/i.test(fs.readFileSync(f, 'utf8'))).map((f) => f.pathname.split('/src/')[1]);
  assert.deepEqual(readers, ['routes/notes.routes.js']);
});
