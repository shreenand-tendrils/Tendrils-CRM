import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { requireInternal, requirePermission } from '../middleware/index.js';
import { AppError } from '../errors/AppError.js';
import { diskStorage, storagePath, discard } from '../services/storage.js';
import { logActivity } from '../services/activity.js';
import {
  computeStatus, normalizeLinks, parseDue, todayUtc, jsonList, resolveReviewers, reviewInclude, loadReview, shape,
  canSeeReview, refreshStatus, pingReview,
} from '../services/reviews.service.js';

const router = Router();
router.use('/reviews', requireInternal); // product reviews are staff-only

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.heic', '.heif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx', '.csv', '.txt', '.md', '.zip', '.fig', '.mp4', '.mov']);
const upload = multer({
  storage: multer.diskStorage(diskStorage('reviews')),
  limits: { fileSize: env.maxUploadBytes, files: 12 },
  fileFilter: (_r, f, cb) => (ALLOWED_EXT.has(path.extname(f.originalname || '').toLowerCase()) ? cb(null, true) : cb(new AppError(`"${f.originalname}" is a file type that is not allowed.`, 415, 'REVIEW_FILE_TYPE'))),
});
const files = upload.array('files', 12);
const withFiles = (req, res, next) => files(req, res, (err) => (err ? next(err instanceof multer.MulterError ? new AppError(err.code === 'LIMIT_FILE_SIZE' ? `A file is larger than ${Math.round(env.maxUploadBytes / 1048576)} MB.` : err.message, 400) : err) : next()));

const isAdmin = (req) => req.can('admin.view');
const me = (req) => req.currentUser.id;
const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);

async function itemRows({ reviewId, version, addedById, links, uploaded }) {
  return [
    ...links.map((l) => ({ reviewId, version, addedById, kind: 'LINK', title: l.title, url: l.url })),
    ...uploaded.map((f) => ({ reviewId, version, addedById, kind: 'FILE', title: path.basename(f.originalname).slice(0, 200), originalName: path.basename(f.originalname).slice(0, 255), storageKey: f.filename, mimeType: f.mimetype, size: f.size })),
  ];
}
const discardAll = (list = []) => Promise.all(list.map((f) => discard(f).catch(() => {})));

async function mustLoad(req, id, { requester = false } = {}) {
  const r = await prisma.productReview.findUnique({ where: { id }, include: { reviewers: true } });
  if (!r || !canSeeReview(r, me(req), isAdmin(req))) throw new AppError('Review not found', 404);
  if (requester && r.requesterId !== me(req)) throw new AppError('Only the person who asked for this review can do that.', 403, 'REVIEW_REQUESTER_ONLY');
  return r;
}

// People and teams the "new review" form can choose from.
router.get('/reviews/people', async (req, res) => {
  const [teams, users] = await Promise.all([
    prisma.team.findMany({
      where: { isActive: true, organization: { type: 'INTERNAL' } }, orderBy: { name: 'asc' },
      select: { id: true, name: true, members: { select: { membership: { select: { userId: true, isActive: true } } } } },
    }),
    prisma.user.findMany({
      where: { memberships: { some: { isActive: true, role: { in: ['PLATFORM_ADMIN', 'EMPLOYEE'] }, organization: { type: 'INTERNAL', isActive: true } } } },
      orderBy: { name: 'asc' }, select: { id: true, name: true, email: true },
    }),
  ]);
  res.json({
    users,
    teams: teams.map((t) => ({ id: t.id, name: t.name, userIds: t.members.filter((m) => m.membership.isActive).map((m) => m.membership.userId) })),
  });
});

// All reviews I can see: ones I asked for, ones waiting on me, and (admins) everything.
router.get('/reviews', async (req, res) => {
  const where = isAdmin(req) ? {} : { OR: [{ requesterId: me(req) }, { reviewers: { some: { userId: me(req) } } }] };
  const rows = await prisma.productReview.findMany({ where, include: { requester: reviewInclude.requester, reviewers: reviewInclude.reviewers, items: { select: { id: true, version: true, kind: true } } }, orderBy: { updatedAt: 'desc' }, take: 300 });
  res.json(rows.map((r) => ({ ...shape(r), itemCount: r.items.filter((i) => i.version === r.version).length, isRequester: r.requesterId === me(req), myDecision: r.reviewers.find((x) => x.userId === me(req))?.decision || null })));
});

router.post('/reviews', requirePermission('review.request'), withFiles, async (req, res) => {
  const uploaded = req.files || [];
  try {
    const title = cleanText(req.body.title, 160);
    if (!title) throw new AppError('Give the review a title.', 400);
    const links = normalizeLinks(req.body.links);
    if (!links.length && !uploaded.length) throw new AppError('Add at least one link or file to review.', 400, 'REVIEW_EMPTY');
    const dueDate = parseDue(req.body.dueDate);
    if (dueDate && dueDate < todayUtc()) throw new AppError('The due date cannot be in the past.', 400, 'REVIEW_BAD_DUE');
    const teamIds = jsonList(req.body.teamIds);
    const reviewerIds = await resolveReviewers({ teamIds, userIds: jsonList(req.body.reviewerIds), requesterId: me(req) });
    if (!reviewerIds.length) throw new AppError('Choose at least one reviewer or team (someone other than you).', 400, 'REVIEW_NO_REVIEWERS');

    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.productReview.create({ data: { title, description: cleanText(req.body.description, 4000) || null, dueDate, requesterId: me(req), teamIds, reviewers: { create: reviewerIds.map((userId) => ({ userId })) } } });
      await tx.productReviewItem.createMany({ data: await itemRows({ reviewId: created.id, version: 1, addedById: me(req), links, uploaded }) });
      await tx.productReviewComment.create({ data: { reviewId: created.id, authorId: me(req), kind: 'SYSTEM', body: 'Asked for a review', version: 1 } });
      return created;
    });
    const full = await loadReview(review.id, me(req));
    logActivity({ actorId: me(req), organizationId: null, entityType: 'ProductReview', entityId: review.id, action: 'review.created', summary: `Asked for a review: ${title}` });
    pingReview({ userIds: reviewerIds, actorId: me(req), review: full, kind: 'request', items: full.items.filter((i) => i.version === 1), title: `Review requested: ${title}`, body: `${req.currentUser.name || req.currentUser.email} asked you to review "${title}".` });
    res.status(201).json(full);
  } catch (e) { await discardAll(uploaded); throw e; }
});

router.get('/reviews/:id', async (req, res) => {
  await mustLoad(req, req.params.id);
  res.json(await loadReview(req.params.id, me(req)));
});

// Add more links/files. `newVersion=true` starts a new round: every reviewer's decision resets and they are told.
router.post('/reviews/:id/items', withFiles, async (req, res) => {
  const uploaded = req.files || [];
  try {
    const r = await mustLoad(req, req.params.id, { requester: true });
    if (r.status === 'CANCELLED') throw new AppError('This review was withdrawn.', 409);
    const links = normalizeLinks(req.body.links);
    if (!links.length && !uploaded.length) throw new AppError('Add a link or a file.', 400, 'REVIEW_EMPTY');
    const newVersion = String(req.body.newVersion) === 'true';
    const version = newVersion ? r.version + 1 : r.version;
    const note = cleanText(req.body.note, 1000);
    await prisma.$transaction(async (tx) => {
      await tx.productReviewItem.createMany({ data: await itemRows({ reviewId: r.id, version, addedById: me(req), links, uploaded }) });
      if (newVersion) {
        await tx.productReview.update({ where: { id: r.id }, data: { version, status: 'IN_REVIEW' } });
        await tx.productReviewer.updateMany({ where: { reviewId: r.id }, data: { decision: 'PENDING', decidedAt: null, note: null } });
        await tx.productReviewComment.create({ data: { reviewId: r.id, authorId: me(req), kind: 'VERSION', body: note || `Uploaded version ${version}`, version } });
      }
    });
    const full = await loadReview(r.id, me(req));
    if (newVersion) pingReview({ userIds: r.reviewers.map((x) => x.userId), actorId: me(req), review: full, kind: 'version', note, items: full.items.filter((i) => i.version === version), title: `New version to review: ${r.title}`, body: `Version ${version} is ready. Your earlier decision was reset.` });
    res.status(201).json(full);
  } catch (e) { await discardAll(uploaded); throw e; }
});

// A reviewer's decision. Changing your mind is allowed until a new version resets everything.
router.post('/reviews/:id/decision', async (req, res) => {
  const r = await mustLoad(req, req.params.id);
  const slot = r.reviewers.find((x) => x.userId === me(req));
  if (!slot) throw new AppError('You are not a reviewer on this request.', 403, 'REVIEW_NOT_REVIEWER');
  if (r.status === 'CANCELLED') throw new AppError('This review was withdrawn.', 409);
  const decision = req.body.decision;
  if (!['APPROVED', 'CHANGES_REQUESTED'].includes(decision)) throw new AppError('Choose Approve or Request changes.', 400);
  const note = cleanText(req.body.note, 2000);
  if (decision === 'CHANGES_REQUESTED' && !note) throw new AppError('Tell them what to change.', 400, 'REVIEW_NOTE_REQUIRED');
  await prisma.$transaction([
    prisma.productReviewer.update({ where: { reviewId_userId: { reviewId: r.id, userId: me(req) } }, data: { decision, note: note || null, decidedAt: new Date() } }),
    prisma.productReviewComment.create({ data: { reviewId: r.id, authorId: me(req), kind: decision === 'APPROVED' ? 'APPROVED' : 'CHANGES', body: note || (decision === 'APPROVED' ? 'Approved' : ''), version: r.version } }),
  ]);
  const change = await refreshStatus(r.id);
  const full = await loadReview(r.id, me(req));
  const name = req.currentUser.name || req.currentUser.email;
  const kind = decision === 'APPROVED' ? 'approved' : 'changes';
  pingReview({ userIds: [r.requesterId], actorId: me(req), review: full, kind, note, items: [], title: decision === 'APPROVED' ? `${name} approved: ${r.title}` : `${name} asked for changes: ${r.title}`, body: note || (decision === 'APPROVED' ? 'No comments.' : '') });
  // Everyone approved: tell the requester once with a clear subject.
  if (change && change.before !== 'APPROVED' && change.after === 'APPROVED') pingReview({ userIds: [r.requesterId], actorId: null, review: full, kind: 'approved', items: [], title: `Fully approved: ${r.title}`, body: 'Every reviewer approved this.' });
  res.json(full);
});

router.post('/reviews/:id/comments', async (req, res) => {
  const r = await mustLoad(req, req.params.id);
  const body = cleanText(req.body.body, 4000);
  if (!body) throw new AppError('Write a comment first.', 400);
  await prisma.productReviewComment.create({ data: { reviewId: r.id, authorId: me(req), kind: 'COMMENT', body, version: r.version } });
  const full = await loadReview(r.id, me(req));
  const others = [r.requesterId, ...r.reviewers.map((x) => x.userId)];
  pingReview({ userIds: others, actorId: me(req), review: full, kind: 'comment', title: `${req.currentUser.name || req.currentUser.email} commented on: ${r.title}`, body: body.slice(0, 200) });
  res.status(201).json(full);
});

// Add reviewers later (people or teams).
router.post('/reviews/:id/reviewers', async (req, res) => {
  const r = await mustLoad(req, req.params.id, { requester: true });
  if (r.status === 'CANCELLED') throw new AppError('This review was withdrawn.', 409);
  const teamIds = jsonList(req.body.teamIds);
  const have = new Set(r.reviewers.map((x) => x.userId));
  const added = (await resolveReviewers({ teamIds, userIds: jsonList(req.body.reviewerIds), requesterId: me(req) })).filter((id) => !have.has(id));
  if (!added.length) throw new AppError('Those people are already reviewers (or nobody was chosen).', 400);
  await prisma.$transaction([
    prisma.productReviewer.createMany({ data: added.map((userId) => ({ reviewId: r.id, userId })) }),
    prisma.productReview.update({ where: { id: r.id }, data: { teamIds: [...new Set([...r.teamIds, ...teamIds])] } }),
  ]);
  await refreshStatus(r.id);
  const full = await loadReview(r.id, me(req));
  pingReview({ userIds: added, actorId: me(req), review: full, kind: 'request', items: full.items.filter((i) => i.version === full.version), title: `Review requested: ${r.title}`, body: `${req.currentUser.name || req.currentUser.email} asked you to review "${r.title}".` });
  res.json(full);
});

// Nudge everyone who has not decided yet (at most once every 6 hours).
router.post('/reviews/:id/remind', async (req, res) => {
  const r = await mustLoad(req, req.params.id, { requester: true });
  if (!['IN_REVIEW', 'CHANGES_REQUESTED'].includes(r.status)) throw new AppError('Nothing to remind: this review is finished.', 409);
  if (r.lastRemindedAt && Date.now() - new Date(r.lastRemindedAt).getTime() < 6 * 3600 * 1000) throw new AppError('You already sent a reminder a short while ago. Try again later.', 429, 'REVIEW_REMIND_SOON');
  const pending = r.reviewers.filter((x) => x.decision === 'PENDING').map((x) => x.userId);
  if (!pending.length) throw new AppError('Everyone has already responded.', 400);
  await prisma.productReview.update({ where: { id: r.id }, data: { lastRemindedAt: new Date() } });
  const full = await loadReview(r.id, me(req));
  pingReview({ userIds: pending, actorId: me(req), review: full, kind: 'nudge', items: full.items.filter((i) => i.version === full.version), title: `Reminder: please review ${r.title}`, body: 'Your review is still pending.' });
  res.json({ reminded: pending.length });
});

router.post('/reviews/:id/withdraw', async (req, res) => {
  const r = await mustLoad(req, req.params.id, { requester: true });
  if (r.status === 'CANCELLED') return res.json(await loadReview(r.id, me(req)));
  await prisma.$transaction([
    prisma.productReview.update({ where: { id: r.id }, data: { status: 'CANCELLED' } }),
    prisma.productReviewComment.create({ data: { reviewId: r.id, authorId: me(req), kind: 'SYSTEM', body: 'Withdrew this review', version: r.version } }),
  ]);
  res.json(await loadReview(r.id, me(req)));
});

// Reopen a withdrawn review (back to in-review with the current decisions recalculated).
router.post('/reviews/:id/reopen', async (req, res) => {
  const r = await mustLoad(req, req.params.id, { requester: true });
  if (r.status !== 'CANCELLED') throw new AppError('This review is not withdrawn.', 409);
  await prisma.productReview.update({ where: { id: r.id }, data: { status: computeStatus(r.reviewers.map((x) => x.decision), 'IN_REVIEW') } });
  await prisma.productReviewComment.create({ data: { reviewId: r.id, authorId: me(req), kind: 'SYSTEM', body: 'Reopened this review', version: r.version } });
  res.json(await loadReview(r.id, me(req)));
});

// Open or download a file. ?inline=1 shows images/PDFs in the browser instead of downloading.
router.get('/reviews/:id/items/:itemId/file', async (req, res) => {
  await mustLoad(req, req.params.id);
  const item = await prisma.productReviewItem.findFirst({ where: { id: req.params.itemId, reviewId: req.params.id, kind: 'FILE' } });
  if (!item?.storageKey) throw new AppError('File not found', 404);
  const file = storagePath(item.storageKey, 'reviews');
  if (!fs.existsSync(file)) throw new AppError('File not found', 404);
  if (req.query.inline && /^(image\/|application\/pdf)/.test(item.mimeType || '')) { res.type(item.mimeType); return res.sendFile(file); }
  res.download(file, item.originalName || item.title);
});

export default router;
