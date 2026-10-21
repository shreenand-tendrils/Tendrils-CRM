import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsAll, canMentionAll, classifyReceipts, tickStatus, canEditMessage, canDeleteMessage, cleanMentions, publicMessage, EDIT_WINDOW_MS, MAX_PINS } from '../src/services/chatLogic.js';

const t0 = new Date('2026-10-18T10:00:00Z');
const msg = { authorId: 'me', createdAt: t0 };
const at = (s) => new Date(t0.getTime() + s * 1000);

test('ticks: sent -> delivered -> read (✓, ✓✓, blue ✓✓)', () => {
  assert.equal(tickStatus(msg, [{ deliveredAt: null, readAt: null }]), 'sent');
  assert.equal(tickStatus(msg, [{ deliveredAt: at(1), readAt: null }]), 'delivered');
  assert.equal(tickStatus(msg, [{ deliveredAt: at(1), readAt: at(5) }]), 'read');
  assert.equal(tickStatus(msg, [{ deliveredAt: null, readAt: at(5) }]), 'read', 'read implies delivered');
  assert.equal(tickStatus(msg, [{ deliveredAt: at(-60), readAt: at(-30) }]), 'sent', 'older marks do not count');
  assert.equal(tickStatus(msg, []), 'sent');
});

test('ticks in groups: need EVERY other member', () => {
  const rs = [{ deliveredAt: at(1), readAt: at(2) }, { deliveredAt: at(1), readAt: null }];
  assert.equal(tickStatus(msg, rs), 'delivered');
  assert.equal(tickStatus(msg, [rs[0], { deliveredAt: null, readAt: null }]), 'sent');
  assert.equal(tickStatus(msg, [rs[0], { deliveredAt: at(3), readAt: at(4) }]), 'read');
});

test('edit: author only, 15-minute window, not after delete', () => {
  const now = t0.getTime() + 60000;
  assert.ok(canEditMessage(msg, 'me', now));
  assert.ok(!canEditMessage(msg, 'someone', now));
  assert.ok(!canEditMessage(msg, 'me', t0.getTime() + EDIT_WINDOW_MS + 1));
  assert.ok(!canEditMessage({ ...msg, deletedAt: new Date() }, 'me', now));
});

test('delete: author or manager; deleted text is blanked for everyone', () => {
  const ctx = (id, isManager = false) => ({ currentUser: { id }, isManager });
  assert.ok(canDeleteMessage(msg, ctx('me')) && canDeleteMessage(msg, ctx('boss', true)) && !canDeleteMessage(msg, ctx('x')));
  assert.ok(!canDeleteMessage({ ...msg, deletedAt: new Date() }, ctx('me')));
  const shown = publicMessage({ ...msg, body: 'secret', mentionIds: ['a'], deletedAt: new Date() });
  assert.equal(shown.body, ''); assert.deepEqual(shown.mentionIds, []);
});

test('mentions: only real participants, not yourself, de-duplicated', () => {
  assert.deepEqual(cleanMentions(['a', 'a', 'me', 'ghost', 'b'], ['me', 'a', 'b'], 'me'), ['a', 'b']);
  assert.deepEqual(cleanMentions(undefined, ['a'], 'me'), []);
  assert.equal(MAX_PINS, 3);
});

test('@all detection and who may use it', () => {
  assert.ok(mentionsAll('hey @all') && mentionsAll('@Everyone now') && mentionsAll('x @ALL.'));
  assert.ok(!mentionsAll('mail me@all.com') && !mentionsAll('@alliance') && !mentionsAll(''));
  const ctx = (isManager, lead) => ({ isManager, can: (p) => lead && p === 'task.assign' });
  assert.ok(!canMentionAll(ctx(true), { type: 'DIRECT' }));
  assert.ok(canMentionAll(ctx(false), { type: 'PROJECT' }));
  assert.ok(!canMentionAll(ctx(false, false), { type: 'GENERAL' }) && canMentionAll(ctx(false, true), { type: 'GENERAL' }) && canMentionAll(ctx(true), { type: 'GENERAL' }));
});

test('message info buckets: read / delivered / waiting', () => {
  const m = { createdAt: t0 }; const people = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const r = classifyReceipts(m, people, new Map([['a', at(10)]]), new Map([['b', at(2)]]));
  assert.deepEqual(r.readBy.map((x) => x.user.id), ['a']);
  assert.deepEqual(r.deliveredTo.map((x) => x.user.id), ['b']);
  assert.deepEqual(r.pending.map((u) => u.id), ['c']);
});
