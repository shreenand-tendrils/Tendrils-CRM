/** Review authority for tasks routed across teams. */
export const taskReviewerTeamIds = (creatorTeamIds = [], destinationTeamId = null) =>
  [...new Set(creatorTeamIds.filter((id) => id && id !== destinationTeamId))];

export const canApproveTask = ({ canUpdateAny = false, actorTeamIds = [], reviewerTeamIds = [] } = {}) =>
  Boolean(canUpdateAny || reviewerTeamIds.some((id) => actorTeamIds.includes(id)));

export const taskNeedsTeamReview = (reviewerTeamIds = []) => reviewerTeamIds.length > 0;
