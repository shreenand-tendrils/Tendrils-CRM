import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, normalizeLinks, parseDue, jsonList, canSeeReview } from '../src/services/reviewRules.js';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/rbac/permissions.js';

test('status: nobody decided yet is in review', () => {
  assert.equal(computeStatus(['PENDING', 'PENDING']), 'IN_REVIEW');
  assert.equal(computeStatus([]), 'IN_REVIEW');
});
test('status: all approved is approved, one approval is not enough', () => {
  assert.equal(computeStatus(['APPROVED', 'APPROVED']), 'APPROVED');
  assert.equal(computeStatus(['APPROVED', 'PENDING']), 'IN_REVIEW');
});
test('status: any change request wins immediately, even with approvals and pending', () => {
  assert.equal(computeStatus(['APPROVED', 'CHANGES_REQUESTED', 'PENDING']), 'CHANGES_REQUESTED');
});
test('status: a withdrawn review stays withdrawn', () => {
  assert.equal(computeStatus(['APPROVED'], 'CANCELLED'), 'CANCELLED');
});

test('links: adds https, trims, de-duplicates and names them', () => {
  const out = normalizeLinks([{ url: 'example.com/a' }, { url: 'https://example.com/a', title: 'dup' }, ' https://figma.com/file/x ']);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://example.com/a');
  assert.ok(out[0].title.startsWith('example.com'));
});
test('links: javascript: and other schemes are rejected', () => {
  assert.throws(() => normalizeLinks([{ url: 'javascript:alert(1)' }]), /http and https/);
  assert.throws(() => normalizeLinks([{ url: 'ftp://x.com/a' }]), /http and https/);
});
test('links: accepts a JSON string (multipart field) and plain whitespace-separated text', () => {
  assert.equal(normalizeLinks('[{"url":"https://a.com","title":"A"}]')[0].title, 'A');
  assert.equal(normalizeLinks('https://a.com https://b.com').length, 2);
  assert.deepEqual(normalizeLinks(undefined), []);
});

test('due date: date-only is UTC midnight; garbage is rejected; empty is null', () => {
  assert.equal(parseDue('2026-12-01').toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(parseDue(''), null);
  assert.throws(() => parseDue('not-a-date'), /not valid/);
});
test('jsonList: JSON array, comma text, arrays and empty', () => {
  assert.deepEqual(jsonList('["a","b"]'), ['a', 'b']);
  assert.deepEqual(jsonList('a, b'), ['a', 'b']);
  assert.deepEqual(jsonList(['x']), ['x']);
  assert.deepEqual(jsonList(undefined), []);
});

test('visibility: requester, reviewers and admins only', () => {
  const r = { requesterId: 'u1', reviewers: [{ userId: 'u2' }] };
  assert.equal(canSeeReview(r, 'u1', false), true);
  assert.equal(canSeeReview(r, 'u2', false), true);
  assert.equal(canSeeReview(r, 'u3', false), false);
  assert.equal(canSeeReview(r, 'u3', true), true);
});

test('permission: staff can request reviews, clients cannot', () => {
  assert.ok(PERMISSIONS['review.request']);
  assert.ok(ROLE_PERMISSIONS.EMPLOYEE.includes('review.request'));
  assert.ok(ROLE_PERMISSIONS.PLATFORM_ADMIN.includes('review.request'));
  assert.ok(!ROLE_PERMISSIONS.CLIENT_MEMBER.includes('review.request'));
});
