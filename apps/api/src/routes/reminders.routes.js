import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { canViewTicket } from '../rbac/policies.js';
import { parseBody } from '../validators/validate.js';

// FLAGS + REMINDERS. Personal to the signed-in team member: every query is scoped by userId.
// A flag is a reminder with flagged=true and no remindAt. Reminders fire an in-app notification (see services/scheduler.js).
const router = Router();

router.use('/reminders', (req, _res, next) => (req.isInternal ? next() : next(new AppError('Reminders are available to team members only.', 403))));

const include = { ticket: { select: { id: true, key: true, title: true, status: true } } };
const when = z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.date().nullable());
const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ticketId: z.string().min(1).optional().nullable(),
  remindAt: when.optional(),
  flagged: z.boolean().optional(),
});
const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  remindAt: when.optional(),
  flagged: z.boolean().optional(),
  done: z.boolean().optional(),
});

router.get('/reminders/mine', async (req, res) => {
  const where = { userId: req.currentUser.id, ...(req.query.ticketId ? { ticketId: String(req.query.ticketId) } : {}) };
  res.json(await prisma.reminder.findMany({ where, include, orderBy: [{ doneAt: { sort: 'asc', nulls: 'first' } }, { remindAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: 300 }));
});

router.post('/reminders', async (req, res) => {
  const data = parseBody(createSchema, req.body);
  if (!data.flagged && !data.remindAt) throw new AppError('Pick a reminder time, or flag it.', 400);
  if (data.remindAt && data.remindAt.getTime() < Date.now() - 60000) throw new AppError('Reminder time must be in the future.', 400);
  if (data.ticketId) {
    const t = await prisma.ticket.findUnique({ where: { id: data.ticketId }, include: { teamAccesses: { select: { teamId: true, accessRole: true, addedById: true } } } });
    if (!t || !canViewTicket(req, t)) throw new AppError('Ticket not found', 404);
    if (data.flagged && !data.remindAt) {
      const existing = await prisma.reminder.findFirst({ where: { userId: req.currentUser.id, ticketId: t.id, flagged: true, remindAt: null, doneAt: null }, include });
      if (existing) return res.status(200).json(existing);
    }
  }
  const r = await prisma.reminder.create({ data: { userId: req.currentUser.id, ticketId: data.ticketId || null, title: data.title, remindAt: data.remindAt || null, flagged: !!data.flagged }, include });
  res.status(201).json(r);
});

async function mine(req) {
  const r = await prisma.reminder.findFirst({ where: { id: req.params.id, userId: req.currentUser.id } });
  if (!r) throw new AppError('Reminder not found', 404);
  return r;
}

router.patch('/reminders/:id', async (req, res) => {
  const r = await mine(req);
  const d = parseBody(patchSchema, req.body);
  const data = {};
  if (d.title !== undefined) data.title = d.title;
  if (d.flagged !== undefined) data.flagged = d.flagged;
  if (d.remindAt !== undefined) { data.remindAt = d.remindAt; data.notifiedAt = null; }
  if (d.done !== undefined) data.doneAt = d.done ? new Date() : null;
  res.json(await prisma.reminder.update({ where: { id: r.id }, data, include }));
});

router.delete('/reminders/:id', async (req, res) => {
  const r = await mine(req);
  await prisma.reminder.delete({ where: { id: r.id } });
  res.json({ ok: true });
});

export default router;
