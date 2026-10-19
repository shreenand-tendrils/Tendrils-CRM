import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { canSeeOrg, requirePermission, taskTeamScope } from '../middleware/index.js';
import { canViewTicket } from '../rbac/policies.js';
import { env } from '../config/env.js';
import { recordTicketEvents } from '../services/ticketHistory.service.js';

const router = Router();
const dir = path.resolve(env.uploadDir);
fs.mkdirSync(dir, { recursive: true });

const ALLOWED = /^(image\/(jpeg|png|gif|webp)|application\/pdf|text\/plain|application\/zip|application\/vnd\.|application\/msword)/i;
const upload = multer({
  storage: multer.diskStorage({
    destination: dir,
    filename: (_r, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).slice(0, 10)),
  }),
  limits: { fileSize: env.maxUploadBytes },
  fileFilter: (_r, f, cb) => (ALLOWED.test(f.mimetype) ? cb(null, true) : cb(new Error('File type not allowed'))),
});
const discard = (file) => fs.promises.unlink(file.path).catch(() => {});

// Can this caller see the ticket/task an attachment belongs to?
// Tasks are staff-only; INTERNAL tickets are staff-only.
function canAccessTarget(req, rec, kind) {
  if (!rec) return false;
  if (kind === 'ticket') return canViewTicket(req, rec);
  if (!req.isInternal || !canSeeOrg(req, rec.organizationId)) return false;
  if (req.memberships.some((m) => m.organization?.type === 'INTERNAL' && m.role === 'PLATFORM_ADMIN')) return true;
  const teams = new Set(req.memberships.flatMap((m) => (m.teamMemberships || []).map((tm) => tm.teamId)));
  return (rec.teamAccesses || []).some((a) => teams.has(a.teamId));
}

router.post('/files', requirePermission('file.upload'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a file' });
  const { ticketId, taskId } = req.body;
  if (Boolean(ticketId) === Boolean(taskId)) {
    await discard(req.file);
    return res.status(400).json({ error: 'Provide exactly one ticketId or taskId' });
  }
  const kind = ticketId ? 'ticket' : 'task';
  const rec = ticketId ? await prisma.ticket.findUnique({ where: { id: ticketId }, include: { teamAccesses: { select: { teamId: true } } } }) : await prisma.task.findFirst({ where: { id: taskId, ...taskTeamScope(req) }, include: { teamAccesses: { select: { teamId: true } } } });
  if (!canAccessTarget(req, rec, kind)) {
    await discard(req.file);
    return res.status(404).json({ error: 'Target record not found' });
  }
  const a = await prisma.attachment.create({
    data: {
      originalName: path.basename(req.file.originalname).slice(0, 255),
      storageKey: req.file.filename, mimeType: req.file.mimetype, size: req.file.size,
      uploadedById: req.currentUser.id, ticketId: ticketId || null, taskId: taskId || null,
    },
  });
  if (ticketId) await recordTicketEvents(prisma, ticketId, req.currentUser.id, [{ type: 'ATTACHMENT', toValue: a.id, toLabel: a.originalName, clientVisible: rec.visibility === 'CLIENT' }]);
  res.status(201).json({ id: a.id, originalName: a.originalName, size: a.size, mimeType: a.mimeType });
});

router.get('/files/:id/download', async (req, res) => {
  const a = await prisma.attachment.findUnique({ where: { id: req.params.id }, include: { ticket: { include: { teamAccesses: { select: { teamId: true } } } }, task: { include: { teamAccesses: { select: { teamId: true } } } } } });
  if (!a) return res.status(404).json({ error: 'File not found' });
  const ok = a.ticket ? canAccessTarget(req, a.ticket, 'ticket') : canAccessTarget(req, a.task, 'task');
  if (!ok) return res.status(404).json({ error: 'File not found' });
  const file = path.join(dir, path.basename(a.storageKey));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File bytes not found' });
  res.download(file, a.originalName);
});
export default router;
