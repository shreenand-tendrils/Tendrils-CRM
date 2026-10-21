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
      uploadedById: req.currentUser.id, ticketId: ticketId || null, taskId: taskId || null, projectId: projectId || null,
    },
  });
  if (ticketId) await recordTicketEvents(prisma, ticketId, req.currentUser.id, [{ type: 'ATTACHMENT', toValue: a.id, toLabel: a.originalName, clientVisible: rec.visibility === 'CLIENT' }]);
  res.status(201).json({ id: a.id, originalName: a.originalName, size: a.size, mimeType: a.mimeType });
});

router.delete('/files/:id', async (req, res) => {
  const a = await prisma.attachment.findUnique({ where: { id: req.params.id }, include: { ticket: { include: { teamAccesses: { select: { teamId: true } } } }, task: { include: { teamAccesses: { select: { teamId: true } } } }, project: true } });
  if (!a) return res.status(404).json({ error: 'File not found' });
  const target = a.ticket ? a.ticket : a.task ? a.task : a.project;
  const kind = a.ticket ? 'ticket' : a.task ? 'task' : 'project';
  if (!canAccessTarget(req, target, kind)) return res.status(404).json({ error: 'File not found' });
  const elevated = req.isInternal && (req.can('ticket.triage') || req.can('task.assign'));
  if (a.uploadedById !== req.currentUser.id && !elevated) return res.status(403).json({ error: 'Only the uploader or an authorized employee can delete this file.' });
  // Deliberately retain ticket history events: removing a file never rewrites the ticket audit trail.
  await prisma.attachment.delete({ where: { id: a.id } });
  await discard({ path: path.join(dir, path.basename(a.storageKey)) });
  res.json({ ok: true });
});

router.get('/files/:id/download', async (req, res) => {
  const a = await prisma.attachment.findUnique({ where: { id: req.params.id }, include: { ticket: { include: { teamAccesses: { select: { teamId: true } } } }, task: { include: { teamAccesses: { select: { teamId: true } } } }, project: true } });
  if (!a) return res.status(404).json({ error: 'File not found' });
  const ok = a.ticket ? canAccessTarget(req, a.ticket, 'ticket') : a.task ? canAccessTarget(req, a.task, 'task') : canAccessTarget(req, a.project, 'project');
  if (!ok) return res.status(404).json({ error: 'File not found' });
  const file = path.join(dir, path.basename(a.storageKey));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File bytes not found' });
  res.download(file, a.originalName);
});
export default router;
