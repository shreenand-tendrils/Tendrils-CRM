import { Router } from 'express';
import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { normalizeNote } from '../services/notes.js';

// PRIVATE NOTES. Only the author can read, change or delete their notes.
// Deliberately: no email, no notification, no ActivityLog entry, no admin/manager read route.
// Every query below is scoped by `userId: req.currentUser.id`.
const router = Router();

router.use('/notes', (req, res, next) => {
  if (!req.isInternal) return next(new AppError('Notes are available to team members only.', 403));
  res.set('Cache-Control', 'no-store');
  next();
});

const mineWhere = (req, extra = {}) => ({ userId: req.currentUser.id, ...extra });
const view = ({ id, date, title, body, createdAt, updatedAt }) => ({ id, date, title, body, createdAt, updatedAt });

router.get('/notes/mine', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const take = Math.min(Math.max(Number(req.query.take) || 100, 1), 200);
  const rows = await prisma.privateNote.findMany({
    where: mineWhere(req, q ? { OR: [{ body: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }] } : {}),
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take,
  });
  res.json(rows.map(view));
});

router.post('/notes', async (req, res) => {
  const { value, error } = normalizeNote(req.body);
  if (error) throw new AppError(error, 400, 'VALIDATION_ERROR');
  const row = await prisma.privateNote.create({ data: { userId: req.currentUser.id, ...value } });
  res.status(201).json(view(row));
});

router.patch('/notes/:id', async (req, res) => {
  const { value, error } = normalizeNote(req.body, { partial: true });
  if (error) throw new AppError(error, 400, 'VALIDATION_ERROR');
  const { count } = await prisma.privateNote.updateMany({ where: mineWhere(req, { id: req.params.id }), data: value });
  if (!count) throw new AppError('Note not found', 404);
  res.json(view(await prisma.privateNote.findFirst({ where: mineWhere(req, { id: req.params.id }) })));
});

router.delete('/notes/:id', async (req, res) => {
  const { count } = await prisma.privateNote.deleteMany({ where: mineWhere(req, { id: req.params.id }) });
  if (!count) throw new AppError('Note not found', 404);
  res.status(204).end();
});

export default router;
