import { Router } from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/index.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { chatMessageCreate, chatMessageEdit, dmCreate } from '../validators/schemas.js';
import { listRooms, loadRoomFor, sendMessage, markRead, getOrCreateDm, editMessage, deleteMessage, setPinned, listPins, roomMembers, getReceipts, messageInfo, messageInclude, openTicketRoom, ticketDiscussionSummary, inviteToRoom, setRoomResolved, messageToTask } from '../services/chat.service.js';
import { publicMessage } from '../services/chatLogic.js';

// REST side of chat (history, fallback send). Live delivery is over the WebSocket (/ws).
const router = Router();
router.use('/chat', requirePermission('chat.use'));
const authorSelect = { author: { select: { id: true, name: true, email: true, image: true } } };

router.get('/chat/rooms', async (req, res) => res.json(await listRooms(req)));

router.get('/chat/unread', async (req, res) => res.json({ total: (await listRooms(req)).reduce((n, r) => n + r.unread, 0) }));

router.post('/chat/dm', async (req, res) => {
  const { userId } = parseBody(dmCreate, req.body);
  res.status(201).json(await getOrCreateDm(req, userId));
});

router.get('/chat/rooms/:id/messages', async (req, res) => {
  const room = await loadRoomFor(req, req.params.id);
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  if (before && Number.isNaN(before.getTime())) throw new AppError('Invalid "before" timestamp', 400);
  const rows = await prisma.chatMessage.findMany({
    where: { roomId: room.id, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: 'desc' }, take: 50, include: messageInclude,
  });
  res.json(rows.reverse().map(publicMessage));
});

router.post('/chat/rooms/:id/messages', async (req, res) => {
  const { body, mentionIds, replyToId } = parseBody(chatMessageCreate, req.body);
  res.status(201).json(await sendMessage(req, req.params.id, body, mentionIds, replyToId));
});

router.post('/chat/rooms/:id/read', async (req, res) => {
  await markRead(req, req.params.id);
  res.json({ ok: true });
});

router.get('/chat/rooms/:id/pins', async (req, res) => res.json(await listPins(req, req.params.id)));
router.get('/chat/rooms/:id/members', async (req, res) => res.json(await roomMembers(req, req.params.id)));
router.get('/chat/rooms/:id/receipts', async (req, res) => res.json(await getReceipts(req, req.params.id)));

// WhatsApp-style message actions. Edit: author, 15 min. Delete for everyone: author or manager. Pin: any participant (max 3).
router.get('/chat/messages/:id/info', async (req, res) => res.json(await messageInfo(req, req.params.id)));
router.patch('/chat/messages/:id', async (req, res) => res.json(await editMessage(req, req.params.id, parseBody(chatMessageEdit, req.body).body)));
router.delete('/chat/messages/:id', async (req, res) => res.json(await deleteMessage(req, req.params.id)));
router.put('/chat/messages/:id/pin', async (req, res) => res.json(await setPinned(req, req.params.id, true)));
router.delete('/chat/messages/:id/pin', async (req, res) => res.json(await setPinned(req, req.params.id, false)));

// Ticket discussions (live rooms tied to one ticket).
router.post('/chat/ticket/:ticketId', async (req, res) => res.json(await openTicketRoom(req, req.params.ticketId)));
router.get('/chat/ticket/:ticketId/summary', async (req, res) => res.json(await ticketDiscussionSummary(req, req.params.ticketId)));
const idArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, 100) : []);
router.post('/chat/rooms/:id/invite', async (req, res) => res.json(await inviteToRoom(req, req.params.id, { userIds: idArray(req.body?.userIds), teamIds: idArray(req.body?.teamIds) })));
router.put('/chat/rooms/:id/resolved', async (req, res) => res.json(await setRoomResolved(req, req.params.id, req.body?.resolved !== false)));
router.post('/chat/messages/:id/task', async (req, res) => res.status(201).json(await messageToTask(req, req.params.id)));
export default router;
