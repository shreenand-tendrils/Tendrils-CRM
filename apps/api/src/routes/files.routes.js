import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../db.js';
import { canSeeOrg, requirePermission, taskTeamScope } from '../middleware/index.js';
import { canViewTicket } from '../rbac/policies.js';
import { env } from '../config/env.js';
import { recordTicketEvents } from '../services/ticketHistory.service.js';
import { diskStorage, storagePath, discard } from '../services/storage.js';
import { AppError } from '../errors/AppError.js';

const router = Router();

const ALLOWED = /^(image\/(jpeg|png|gif|webp)|application\/pdf|text\/(plain|csv)|application\/zip|application\/vnd\.|application\/msword)/i;
const upload = multer({
  storage: multer.diskStorage(diskStorage()),
  limits: { fileSize: env.maxUploadBytes },
  fileFilter: (_r, f, cb) => (ALLOWED.test(f.mimetype) ? cb(null, true) : cb(new Error('File type not allowed'))),
});

// Can this caller see the ticket/task an attachment belongs to?
// Tasks are staff-only; INTERNAL tickets are staff-only.
function canAccessTarget(req, rec, kind) {
  if (!rec) return false;
  if (kind === 'ticket') return canViewTicket(req, rec);
  if (kind === 'project') return canSeeOrg(req, rec.organizationId);
  if (!req.isInternal || !canSeeOrg(req, rec.organizationId)) return false;
  if (req.memberships.some((m) => m.organization?.type === 'INTERNAL' && m.role === 'PLATFORM_ADMIN')) return true;
  const teams = new Set(req.memberships.flatMap((m) => (m.teamMemberships || []).map((tm) => tm.teamId)));
  return (rec.teamAccesses || []).some((a) => teams.has(a.teamId));
}

router.post('/files', requirePermission('file.upload'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a file' });
  const { ticketId, taskId, projectId } = req.body;
  if ([ticketId, taskId, projectId].filter(Boolean).length !== 1) {
    await discard(req.file);
    return res.status(400).json({ error: 'Provide exactly one ticketId, taskId or projectId' });
  }
  const kind = ticketId ? 'ticket' : taskId ? 'task' : 'project';
  const rec = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : ticketId ? await prisma.ticket.findUnique({ where: { id: ticketId }, include: { teamAccesses: { select: { teamId: true } } } }) : await prisma.task.findFirst({ where: { id: taskId, ...taskTeamScope(req) }, include: { teamAccesses: { select: { teamId: true } } } });
  if (!canAccessTarget(req, rec, kind)) {
    await discard(req.file);
    return res.status(404).json({ error: 'Target record not found' });
  }
  const a = await prisma.attachment.create({
    data: {
      originalName: path.basename(req.file.originalname).slice(0, 255),
      storageKey: req.file.filename, mimeType: req.file.mimetype, size: req.file.size,
      uploadedById: req.currentUser.id, ticketId: ticketId || null, taskId: taskId || null, projectId: projectId || null, inline: ['1', 'true'].includes(String(req.body.inline)),
    },
  });
  const isInline = ['1', 'true'].includes(String(req.body.inline)); // pasted into a description/comment: no history noise
  if (ticketId && !isInline) await recordTicketEvents(prisma, ticketId, req.currentUser.id, [{ type: 'ATTACHMENT', toValue: a.id, toLabel: a.originalName, clientVisible: rec.visibility === 'CLIENT' }]);
  res.status(201).json({ id: a.id, originalName: a.originalName, size: a.size, mimeType: a.mimeType, inline: a.inline });
});

router.get('/files/:id/download', async (req, res) => {
  const a = await prisma.attachment.findUnique({ where: { id: req.params.id }, include: { ticket: { include: { teamAccesses: { select: { teamId: true } } } }, task: { include: { teamAccesses: { select: { teamId: true } } } }, project: true } });
  if (!a) return res.status(404).json({ error: 'File not found' });
  const ok = a.ticket ? canAccessTarget(req, a.ticket, 'ticket') : a.task ? canAccessTarget(req, a.task, 'task') : canAccessTarget(req, a.project, 'project');
  if (!ok) return res.status(404).json({ error: 'File not found' });
  const file = storagePath(a.storageKey);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File bytes not found' });
  res.download(file, a.originalName);
});
// Remove a file or a pasted image. It never touches the ticket, its history or its status: the "added a file" history entry stays.
router.delete('/files/:id', async (req, res) => {
  const a = await prisma.attachment.findUnique({ where: { id: req.params.id }, include: { ticket: { include: { teamAccesses: { select: { teamId: true, accessRole: true, addedById: true } } } }, task: { include: { teamAccesses: { select: { teamId: true } } } }, project: true } });
  if (!a) throw new AppError('File not found', 404);
  const ok = a.ticket ? canAccessTarget(req, a.ticket, 'ticket') : a.task ? canAccessTarget(req, a.task, 'task') : canAccessTarget(req, a.project, 'project');
  if (!ok) throw new AppError('File not found', 404);
  if (a.uploadedById !== req.currentUser.id && !(req.isInternal && req.can('ticket.triage'))) throw new AppError('You can only remove files you added.', 403);
  await prisma.attachment.delete({ where: { id: a.id } });
  await discard(storagePath(a.storageKey));
  res.json({ ok: true });
});

export default router;
