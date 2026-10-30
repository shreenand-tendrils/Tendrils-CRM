import test from 'node:test';
import assert from 'node:assert/strict';
import { taskCreate, taskUpdate, projectCreate, ticketCreate, ticketUpdate } from '../src/validators/schemas.js';

const base = { organizationId: 'org1' };

test('task/project/ticket accept YYYY-MM-DD and ISO datetimes', () => {
  for (const dueDate of ['2026-12-31', '2026-12-31T10:30:00.000Z', '2026-12-31T10:30:00+05:30']) {
    assert.ok(taskCreate.parse({ ...base, title: 'Task', dueDate }).dueDate instanceof Date);
    assert.ok(projectCreate.parse({ ...base, name: 'Proj', dueDate, startDate: dueDate }).dueDate instanceof Date);
    assert.ok(ticketCreate.parse({ ...base, title: 'Tick', dueDate }).dueDate instanceof Date);
  }
  assert.equal(taskCreate.parse({ ...base, title: 'Task', dueDate: '2026-12-31' }).dueDate.toISOString(), '2026-12-31T00:00:00.000Z');
});

test('empty and null dates behave', () => {
  assert.equal(taskCreate.parse({ ...base, title: 'Task', dueDate: '' }).dueDate, undefined);
  assert.equal(taskUpdate.parse({ dueDate: null }).dueDate, null);
  assert.equal(ticketUpdate.parse({ dueDate: '' }).dueDate, null);
});

test('invalid dates and enums are rejected', () => {
  for (const dueDate of ['2026-02-31', 'tomorrow', '31/12/2026']) {
    assert.equal(taskCreate.safeParse({ ...base, title: 'Task', dueDate }).success, false, dueDate);
  }
  assert.equal(taskCreate.safeParse({ ...base, title: 'Task', status: 'NOPE' }).success, false);
  assert.equal(ticketCreate.safeParse({ ...base, title: 'Tick', priority: 'CRITICAL' }).success, false);
});

test('validator enums match prisma/schema.prisma', async () => {
  const fs = await import('node:fs');
  const enums = await import('../src/validators/enums.js');
  const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  for (const [name, values] of Object.entries(enums)) {
    const block = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`))?.[1];
    assert.ok(block, `enum ${name} missing in schema`);
    assert.deepEqual(block.trim().split(/\s+/), values, name);
  }
});

test('multi-assignee, members and daily update schemas', async () => {
  const s = await import('../src/validators/schemas.js');
  const { resolveAssignees } = await import('../src/services/review.js');
  assert.deepEqual(s.taskCreate.parse({ organizationId: 'o', title: 'Task', assigneeIds: ['a', 'b'] }).assigneeIds, ['a', 'b']);
  assert.equal(s.taskCreate.safeParse({ organizationId: 'o', title: 'Task', assigneeIds: 'a' }).success, false);
  assert.deepEqual(resolveAssignees({ assigneeIds: ['a', 'a', 'b'] }), ['a', 'b']);
  assert.deepEqual(resolveAssignees({ assigneeId: null }), []);
  assert.equal(resolveAssignees({}), undefined);
  const u = s.dailyUpdateUpsert.parse({ date: '2026-10-16', yesterday: 'did x', today: 'do y', blockers: '' });
  assert.equal(u.date.toISOString(), '2026-10-16T00:00:00.000Z');
  assert.equal(u.blockers, undefined);
  assert.equal(s.dailyUpdateUpsert.safeParse({ yesterday: '', today: 'y' }).success, false);
  assert.equal(s.chatMessageCreate.safeParse({ body: '   ' }).success, false);
});
