import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { REVIEW_STATUSES, computeStatus, normalizeLinks, parseDue, todayUtc, jsonList, canSeeReview } from './reviewRules.js';
import { notifyUser } from './activity.js';
import { fireAndLog, sendReviewEmail } from './email.service.js';

/**
 * Product reviews: "please review this" requests with links / screenshots / files.
 * Pure rules sit on top (no DB, unit-tested). The API is always the authority; the web UI mirrors them for display.
 */

export { REVIEW_STATUSES, computeStatus, normalizeLinks, parseDue, todayUtc, jsonList, canSeeReview };

const userSel = { select: { id: true, name: true, email: true } };

/** Active internal staff in any of the given teams. */
export async function peopleInTeams(teamIds = []) {
  if (!teamIds.length) return [];
  return prisma.user.findMany({
    where: { memberships: { some: { isActive: true, role: { in: ['PLATFORM_ADMIN', 'EMPLOYEE'] }, organization: { type: 'INTERNAL', isActive: true }, teamMemberships: { some: { teamId: { in: teamIds } } } } } },
    select: { id: true },
  });
}

/** Keep only active internal staff (clients never review). */
export async function staffOnly(userIds = []) {
  if (!userIds.length) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds }, memberships: { some: { isActive: true, role: { in: ['PLATFORM_ADMIN', 'EMPLOYEE'] }, organization: { type: 'INTERNAL', isActive: true } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Everyone who should be a reviewer: chosen teams' people plus chosen individuals, never the requester. */
export async function resolveReviewers({ teamIds = [], userIds = [], requesterId }) {
  const fromTeams = (await peopleInTeams(teamIds)).map((u) => u.id);
  const all = await staffOnly([...new Set([...fromTeams, ...userIds])]);
  return all.filter((id) => id !== requesterId);
}

export const reviewInclude = {
  requester: userSel,
  items: { orderBy: [{ version: 'desc' }, { createdAt: 'asc' }] },
  reviewers: { include: { user: userSel }, orderBy: { createdAt: 'asc' } },
};

/** Full payload for one viewer. */
export async function loadReview(id, viewerId) {
  const r = await prisma.productReview.findUnique({
    where: { id },
    include: { ...reviewInclude, comments: { orderBy: { createdAt: 'asc' }, include: { author: userSel } } },
  });
  if (!r) return null;
  const teams = r.teamIds.length ? await prisma.team.findMany({ where: { id: { in: r.teamIds } }, select: { id: true, name: true } }) : [];
  const mine = r.reviewers.find((x) => x.userId === viewerId);
  return { ...shape(r), teams, comments: r.comments, isRequester: r.requesterId === viewerId, isReviewer: !!mine, myDecision: mine?.decision || null };
}

/** List-row payload: counts instead of everything. */
export function shape(r) {
  const reviewers = (r.reviewers || []).map((x) => ({ userId: x.userId, user: x.user, decision: x.decision, note: x.note, decidedAt: x.decidedAt }));
  return {
    id: r.id, title: r.title, description: r.description, status: r.status, version: r.version, dueDate: r.dueDate, teamIds: r.teamIds,
    requesterId: r.requesterId, requester: r.requester, createdAt: r.createdAt, updatedAt: r.updatedAt, lastRemindedAt: r.lastRemindedAt,
    items: (r.items || []).map(({ storageKey, ...i }) => i),
    reviewers,
    counts: { total: reviewers.length, approved: reviewers.filter((x) => x.decision === 'APPROVED').length, changes: reviewers.filter((x) => x.decision === 'CHANGES_REQUESTED').length, pending: reviewers.filter((x) => x.decision === 'PENDING').length },
  };
}


/** Re-derive and save the overall status after any decision/version/reviewer change. */
export async function refreshStatus(reviewId) {
  const r = await prisma.productReview.findUnique({ where: { id: reviewId }, include: { reviewers: true } });
  if (!r) return null;
  const status = computeStatus(r.reviewers.map((x) => x.decision), r.status);
  if (status !== r.status) await prisma.productReview.update({ where: { id: reviewId }, data: { status } });
  return { before: r.status, after: status, review: r };
}

const href = (id) => `/reviews?open=${id}`;

/** In-app notification + rich email for each person (never the actor). kind drives the email wording. */
export async function pingReview({ userIds, actorId, review, kind, note, items = [], title, body }) {
  const ids = [...new Set(userIds)].filter((id) => id && id !== actorId);
  if (!ids.length) return;
  const [users, actor] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
    actorId ? prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } }) : null,
  ]);
  for (const u of users) {
    try { await notifyUser({ userId: u.id, type: kind === 'reminder' ? 'DUE_SOON' : 'APPROVAL', title, body, href: href(review.id) }); } catch (e) { console.error('[review] in-app failed for', u.id, e.message); }
    if (kind !== 'comment' && u.email) {
      fireAndLog(sendReviewEmail({ to: u.email, name: u.name, kind, review, items, note, actorName: actor?.name || actor?.email, href: href(review.id) }));
    }
  }
}
export const reviewHref = href;
