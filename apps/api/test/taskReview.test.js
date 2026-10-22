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
