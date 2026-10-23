import test from 'node:test';
import assert from 'node:assert/strict';
import { canApproveTask, taskReviewerTeamIds, taskNeedsTeamReview } from '../src/services/taskReviewRules.js';

test('cross-team task records creator teams other than the destination as reviewers', () => {
  assert.deepEqual(taskReviewerTeamIds(['design', 'engineering', 'design'], 'engineering'), ['design']);
  assert.deepEqual(taskReviewerTeamIds(['engineering'], 'engineering'), []);
});

test('only the requester/reviewer team or an authorized global reviewer can approve a task', () => {
  const reviewerTeamIds = ['requesting-team'];
  assert.equal(taskNeedsTeamReview(reviewerTeamIds), true);
  assert.equal(canApproveTask({ actorTeamIds: ['receiving-team'], reviewerTeamIds }), false);
  assert.equal(canApproveTask({ actorTeamIds: ['requesting-team'], reviewerTeamIds }), true);
  assert.equal(canApproveTask({ canUpdateAny: true, actorTeamIds: ['receiving-team'], reviewerTeamIds }), true);
  assert.equal(canApproveTask({ actorTeamIds: ['receiving-team'], reviewerTeamIds: [] }), false);
});

import { reviewAuthorityOf, canFinishTask } from '../src/services/taskReviewRules.js';

test('review authority: who reviews which task', () => {
  assert.equal(reviewAuthorityOf({ autoCreated: true }), 'TICKET');
  assert.equal(reviewAuthorityOf({ parentId: 'p', ticketIsClient: true }), 'NONE', 'subtasks are the doer’s checklist');
  assert.equal(reviewAuthorityOf({ ticketIsClient: true, creatorId: 'a', assigneeIds: ['b'] }), 'CLIENT');
  assert.equal(reviewAuthorityOf({ reviewerTeamIds: ['t'], creatorId: 'a', assigneeIds: ['b'] }), 'TEAM');
  assert.equal(reviewAuthorityOf({ creatorId: 'a', assigneeIds: ['b'] }), 'PEER');
  assert.equal(reviewAuthorityOf({ creatorId: 'a', assigneeIds: ['a'] }), 'NONE', 'self-managed task');
  assert.equal(reviewAuthorityOf({ creatorId: 'a', assigneeIds: [] }), 'NONE', 'unassigned task');
});

test('who may mark Done: no deadlocks, no self-approval', () => {
  const base = { actorTeamIds: ['eng'], workTeamIds: ['eng'], creatorId: 'lead', assigneeIds: ['dev'] };
  assert.equal(canFinishTask({ ...base, authority: 'NONE', actorId: 'dev' }), true);
  assert.equal(canFinishTask({ ...base, authority: 'TICKET', actorId: 'admin', canUpdateAny: true }), false);
  assert.equal(canFinishTask({ ...base, authority: 'CLIENT', actorId: 'dev' }), false, 'only the client (or an admin) approves client work');
  assert.equal(canFinishTask({ ...base, authority: 'CLIENT', actorId: 'admin', canUpdateAny: true }), true);
  assert.equal(canFinishTask({ ...base, authority: 'PEER', actorId: 'dev' }), false, 'assignee cannot approve own work');
  assert.equal(canFinishTask({ ...base, authority: 'PEER', actorId: 'mate' }), true, 'teammate can');
  assert.equal(canFinishTask({ ...base, authority: 'PEER', actorId: 'lead', actorTeamIds: [] }), true, 'creator can');
  assert.equal(canFinishTask({ ...base, authority: 'PEER', actorId: 'stranger', actorTeamIds: ['seo'] }), false);
  assert.equal(canFinishTask({ ...base, authority: 'TEAM', actorId: 'x', actorTeamIds: ['design'], reviewerTeamIds: ['design'] }), true);
  assert.equal(canFinishTask({ ...base, authority: 'TEAM', actorId: 'dev', reviewerTeamIds: ['design'] }), false);
});

test('team-to-team: the doer never approves their own work, even if also in the requesting team', () => {
  const base = { authority: 'TEAM', reviewerTeamIds: ['design'], actorTeamIds: ['design', 'eng'], workTeamIds: ['eng'], creatorId: 'lead', assigneeIds: ['dev'] };
  assert.equal(canFinishTask({ ...base, actorId: 'dev' }), false);
  assert.equal(canFinishTask({ ...base, actorId: 'lead', actorTeamIds: ['design'] }), true);
  assert.equal(canFinishTask({ ...base, actorId: 'dev', canUpdateAny: true }), true, 'admin override');
});
