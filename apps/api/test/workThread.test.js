import test from 'node:test';
import assert from 'node:assert/strict';
import { collectThread, buildTree, mergeTimeline } from '../../web/src/lib/workThread.js';

const T = (id, extra = {}) => ({ id, createdAt: `2026-10-0${id.length}T00:00:00Z`, ...extra });

test('collectThread gathers ticket tasks, the focused task with parents, and all subtasks', () => {
  const all = [T('a', { ticketId: 't1' }), T('bb', { parentId: 'a' }), T('ccc', { parentId: 'bb' }), T('dddd', { ticketId: 't2' }), T('eeeee', { parentId: 'dddd' })];
  assert.deepEqual(collectThread(all, { ticketId: 't1' }).map((t) => t.id).sort(), ['a', 'bb', 'ccc']);
  assert.deepEqual(collectThread(all, { focusId: 'ccc' }).map((t) => t.id).sort(), ['a', 'bb', 'ccc']);
  assert.deepEqual(collectThread(all, { focusId: 'dddd' }).map((t) => t.id).sort(), ['dddd', 'eeeee']);
});

test('buildTree nests subtasks and treats unknown parents as roots', () => {
  const tree = buildTree([T('a'), T('bb', { parentId: 'a' }), T('ccc', { parentId: 'missing' })]);
  assert.equal(tree.length, 2);
  assert.equal(tree.find((n) => n.task.id === 'a').children[0].task.id, 'bb');
});

test('mergeTimeline keeps only route events and orders them with root tasks by time', () => {
  const events = [{ id: 'e2', type: 'ASSIGNEE', createdAt: '2026-10-03T00:00:00Z' }, { id: 'e1', type: 'CREATED', createdAt: '2026-10-01T00:00:00Z' }, { id: 'c', type: 'COMMENT', createdAt: '2026-10-02T00:00:00Z' }];
  const roots = [{ task: { id: 'x', createdAt: '2026-10-02T12:00:00Z' }, children: [] }];
  assert.deepEqual(mergeTimeline(events, roots).map((i) => i.event?.id || i.node.task.id), ['e1', 'x', 'e2']);
});
