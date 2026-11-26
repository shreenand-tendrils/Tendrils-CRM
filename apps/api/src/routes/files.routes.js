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
import { loadRoomFor, refreshMessage } from '../services/chat.service.js';

const router = Router();

const ALLOWED_MIME = /^(image\/(jpeg|png|gif|webp|avif|bmp|tiff|heic|heif)|application\/pdf|text\/(plain|csv)|application\/(zip|x-zip-compressed)|application\/vnd\.|application\/msword)/i;
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt', '.zip']);
const allowedUpload = (file) => ALLOWED_MIME.test(file.mimetype || '') || ALLOWED_EXT.has(path.extname(file.originalname || '').toLowerCase());
const upload = multer({
  storage: multer.diskStorage(diskStorage()),
  limits: { fileSize: env.maxUploadBytes },
  fileFilter: (_r, f, cb) => (allowedUpload(f) ? cb(null, true) : cb(new Error('File type not allowed'))),
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
  const { ticketId, taskId, projectId, chatRoomId } = req.body;
  if ([ticketId, taskId, projectId, chatRoomId].filter(Boolean).length !== 1) {
    await discard(req.file);
    return res.status(400).json({ error: 'Provide exactly one ticketId, taskId, projectId or chatRoomId' });
  }
  if (chatRoomId) { // a file or screenshot sent in a ticket discussion: staff in that room only, never on the ticket's Files list
    try { await loadRoomFor(req, chatRoomId); } catch { await discard(req.file); return res.status(404).json({ error: 'Discussion not found' }); }
    const c = await prisma.attachment.create({ data: { originalName: path.basename(req.file.originalname).slice(0, 255), storageKey: req.file.filename, mimeType: req.file.mimetype, size: req.file.size, uploadedById: req.currentUser.id, chatRoomId } });
    return res.status(201).json({ id: c.id, originalName: c.originalName, size: c.size, mimeType: c.mimeType, inline: false });
  }
  const kind = ticketId ? 'ticket' : taskId ? 'task' : 'project';
  const rec = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : ticketId ? await prisma.ticket.findUnique({ where: { id: ticketId }, include: { teamAccesses: { select: { teamId: true } }, collaborators: { select: { userId: true } } } }) : await prisma.task.findFirst({ where: { id: taskId, ...taskTeamScope(req) }, include: { teamAccesses: { select: { teamId: true } } } });
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
  const a = await prisma.attachment.findUnique({ where: { id: req.params.id }, include: { comment: { select: { visibility: true } }, ticket: { include: { teamAccesses: { select: { teamId: true } }, collaborators: { select: { userId: true } } } }, task: { include: { teamAccesses: { select: { teamId: true } } } }, project: true } });
  if (!a) return res.status(404).json({ error: 'File not found' });
  const ok = a.chatRoomId ? await loadRoomFor(req, a.chatRoomId).then(() => true, () => false) : a.ticket ? canAccessTarget(req, a.ticket, 'ticket') : a.task ? canAccessTarget(req, a.task, 'task') : canAccessTarget(req, a.project, 'project');
  if (!ok) return res.status(404).json({ error: 'File not found' });
  if (a.comment?.visibility === 'INTERNAL' && !req.can('ticket.view_internal')) return res.status(404).json({ error: 'File not found' }); // files in internal notes stay internal
  const file = storagePath(a.storageKey);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File bytes not found' });
  res.download(file, a.originalName);
});
// Delete a file or a pasted screenshot for good: the database row AND the stored file on the server.
// Allowed for: the person who uploaded it, the person who created the ticket, and platform admins. It never touches the
// ticket's status; for a ticket's own files a "removed <file>" entry is added to the history (the "attached" entry stays).
const isPlatformAdminReq = (req) => (req.memberships || []).some((m) => m.organization?.type === 'INTERNAL' && m.role === 'PLATFORM_ADMIN');
router.delete('/files/:id', async (req, res) => {
  const a = await prisma.attachment.findUnique({ where: { id: req.params.id }, include: { ticket: { include: { teamAccesses: { select: { teamId: true, accessRole: true, addedById: true } }, collaborators: { select: { userId: true } } } }, task: { include: { teamAccesses: { select: { teamId: true } } } }, project: true } });
  if (!a) throw new AppError('File not found', 404);
  const ok = a.chatRoomId ? await loadRoomFor(req, a.chatRoomId).then(() => true, () => false) : a.ticket ? canAccessTarget(req, a.ticket, 'ticket') : a.task ? canAccessTarget(req, a.task, 'task') : canAccessTarget(req, a.project, 'project');
  if (!ok) throw new AppError('File not found', 404);
  const me = req.currentUser.id;
  const chatTicket = a.chatRoomId ? (await prisma.chatRoom.findUnique({ where: { id: a.chatRoomId }, select: { ticket: { select: { requesterId: true } } } }))?.ticket : null;
  const mayDelete = a.uploadedById === me || (a.ticket && a.ticket.requesterId === me) || (chatTicket && chatTicket.requesterId === me) || isPlatformAdminReq(req);
  if (!mayDelete) throw new AppError('Only the person who created the ticket, the person who uploaded the file, or a platform admin can delete it.', 403);
  await prisma.attachment.delete({ where: { id: a.id } });
  await discard(storagePath(a.storageKey)); // the bytes on the server disk go too
  if (a.chatMessageId) await refreshMessage(a.chatMessageId).catch(() => {}); // the chat message drops the file live
  if (a.ticketId && !a.inline) await recordTicketEvents(prisma, a.ticketId, me, [{ type: 'ATTACHMENT_REMOVED', fromValue: a.id, fromLabel: a.originalName, clientVisible: a.ticket?.visibility === 'CLIENT' }]);
  res.json({ ok: true });
});

export default router;
