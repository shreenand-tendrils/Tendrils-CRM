import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { hub } from '../realtime/hub.js';
import { STAFF_ROLES, MANAGER_ROLES } from './session.js';
import { assertAssignable } from './guards.js';
import { notifyUser } from './activity.js';
import { sendMentionEmail, fireAndLog } from './email.service.js';
import { canEditMessage, canDeleteMessage, cleanMentions, publicMessage, MAX_PINS, mentionsAll, canMentionAll, classifyReceipts } from './chatLogic.js';

// ctx = { currentUser, memberships, isInternal, isManager }
// Chat is staff-only. GENERAL: all staff. PROJECT: project members + managers. DIRECT: the two participants.
const authorSelect = { author: { select: { id: true, name: true, email: true, image: true } } };
// A message with its author and the (short) message it replies to.
export const messageInclude = { ...authorSelect, replyTo: { select: { id: true, body: true, deletedAt: true, authorId: true, author: { select: { id: true, name: true, email: true } } } } };
export const dmKey = (a, b) => [a, b].sort().join(':');
const participants = (room) => room.directKey?.split(':') ?? [];
const uniq = (rows) => [...new Set(rows.map((r) => r.userId))];

export async function loadRoomFor(ctx, roomId) {
  if (!ctx.isInternal) throw new AppError('Chat is available to Tendrils staff only', 403);
  const room = roomId ? await prisma.chatRoom.findUnique({ where: { id: roomId } }) : null;
  if (!room) throw new AppError('Room not found', 404);
  if (room.type === 'DIRECT' && !participants(room).includes(ctx.currentUser.id)) throw new AppError('Room not found', 404);
  if (room.type === 'PROJECT' && !ctx.isManager) {
    const m = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: room.projectId, userId: ctx.currentUser.id } } });
    if (!m) throw new AppError('Room not found', 404);
  }
  return room;
}

export async function roomUserIds(room) {
  if (room.type === 'DIRECT') return participants(room);
  const internal = { isActive: true, organization: { type: 'INTERNAL' } };
  if (room.type === 'GENERAL') return uniq(await prisma.membership.findMany({ where: { ...internal, role: { in: STAFF_ROLES } }, select: { userId: true } }));
  const [members, managers] = await Promise.all([
    prisma.projectMember.findMany({ where: { projectId: room.projectId }, select: { userId: true } }),
    prisma.membership.findMany({ where: { ...internal, role: { in: MANAGER_ROLES } }, select: { userId: true } }),
  ]);
  return uniq([...members, ...managers]);
}

const snippet = (body) => (body.length > 140 ? `${body.slice(0, 137)}…` : body);
const emit = (userIds, payload) => hub.sendToUsers(userIds, payload);

/** Everyone in the room except the author who is online right now has "received" the message (double tick). */
async function markDelivered(room, userIds, at = new Date()) {
  const online = userIds.filter((id) => hub.isOnline(id));
  await Promise.all(online.map((userId) => prisma.chatDelivery.upsert({ where: { roomId_userId: { roomId: room.id, userId } }, update: { deliveredAt: at }, create: { roomId: room.id, userId, deliveredAt: at } })));
  for (const userId of online) emit(userIds, { type: 'chat.receipt', roomId: room.id, userId, kind: 'delivered', at });
}

/** @mention: in-app notification always; email only when the person is offline (no spam while they are chatting). */
async function notifyMentions({ ctx, room, ids, body, everyone = false }) {
  if (!ids.length) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  const by = ctx.currentUser.name || ctx.currentUser.email;
  const where = room.type === 'DIRECT' ? 'a direct message' : room.type === 'GENERAL' ? '#General' : room.name;
  for (const u of users) {
    const href = `/chat?room=${room.id}`;
    await notifyUser({ userId: u.id, type: 'MENTION', title: everyone ? `${by} mentioned everyone in ${where}` : `${by} mentioned you in ${where}`, body: snippet(body), href });
    if (!hub.isOnline(u.id) && u.email) fireAndLog(sendMentionEmail({ to: u.email, name: u.name, byName: by, roomName: where, snippet: snippet(body), href }));
  }
}

export async function sendMessage(ctx, roomId, body, mentionIds = [], replyToId = null) {
  const room = await loadRoomFor(ctx, roomId);
  const me = ctx.currentUser.id;
  const userIds = await roomUserIds(room);
  let mentions = cleanMentions(mentionIds, userIds, me);
  let everyone = false;
  if (mentionsAll(body)) {
    if (!canMentionAll(ctx, room)) throw new AppError(room.type === 'DIRECT' ? '@all only works in group rooms.' : 'Only team leads and managers can use @all in General.', 403, 'MENTION_ALL_DENIED');
    everyone = true;
    mentions = userIds.filter((id) => id !== me);
  }
  if (replyToId && !(await prisma.chatMessage.findFirst({ where: { id: replyToId, roomId: room.id }, select: { id: true } }))) throw new AppError('The message you are replying to was not found in this room.', 400, 'INVALID_REPLY');
  const message = await prisma.chatMessage.create({ data: { roomId: room.id, authorId: me, body, mentionIds: mentions, replyToId: replyToId || null }, include: messageInclude });
  await prisma.chatRead.upsert({
    where: { roomId_userId: { roomId: room.id, userId: me } },
    update: { lastReadAt: message.createdAt },
    create: { roomId: room.id, userId: me, lastReadAt: message.createdAt },
  });
  emit(userIds, { type: 'chat.message', message: publicMessage(message) });
  await markDelivered(room, userIds.filter((id) => id !== me), new Date()).catch((e) => console.error('[chat] delivery failed:', e.message));
  await notifyMentions({ ctx, room, ids: mentions, body, everyone }).catch((e) => console.error('[chat] mention failed:', e.message));
  return message;
}

async function loadMessageFor(ctx, messageId) {
  const msg = await prisma.chatMessage.findUnique({ where: { id: String(messageId || '') }, include: messageInclude });
  if (!msg) throw new AppError('Message not found', 404);
  const room = await loadRoomFor(ctx, msg.roomId); // also enforces room access
  return { msg, room };
}
const broadcastUpdate = async (room, message) => emit(await roomUserIds(room), { type: 'chat.message.updated', message: publicMessage(message) });

export async function editMessage(ctx, messageId, body) {
  const { msg, room } = await loadMessageFor(ctx, messageId);
  if (!canEditMessage(msg, ctx.currentUser.id)) throw new AppError('You can edit your own messages for 15 minutes after sending.', 403, 'EDIT_NOT_ALLOWED');
  const message = await prisma.chatMessage.update({ where: { id: msg.id }, data: { body, editedAt: new Date() }, include: messageInclude });
  await broadcastUpdate(room, message);
  return message;
}

export async function deleteMessage(ctx, messageId) {
  const { msg, room } = await loadMessageFor(ctx, messageId);
  if (!canDeleteMessage(msg, ctx)) throw new AppError("You can't delete this message.", 403);
  const message = await prisma.chatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date(), body: '', mentionIds: [], pinnedAt: null, pinnedById: null }, include: messageInclude });
  await broadcastUpdate(room, message);
  return publicMessage(message);
}

export async function setPinned(ctx, messageId, pinned) {
  const { msg, room } = await loadMessageFor(ctx, messageId);
  if (msg.deletedAt) throw new AppError('This message was deleted.', 400);
  if (pinned && !msg.pinnedAt) {
    if ((await prisma.chatMessage.count({ where: { roomId: room.id, pinnedAt: { not: null } } })) >= MAX_PINS) throw new AppError(`You can pin up to ${MAX_PINS} messages. Unpin one first.`, 400, 'PIN_LIMIT');
  }
  const message = await prisma.chatMessage.update({ where: { id: msg.id }, data: pinned ? { pinnedAt: new Date(), pinnedById: ctx.currentUser.id } : { pinnedAt: null, pinnedById: null }, include: messageInclude });
  await broadcastUpdate(room, message);
  return message;
}

export async function listPins(ctx, roomId) {
  const room = await loadRoomFor(ctx, roomId);
  return prisma.chatMessage.findMany({ where: { roomId: room.id, pinnedAt: { not: null }, deletedAt: null }, orderBy: { pinnedAt: 'desc' }, include: messageInclude });
}

export async function roomMembers(ctx, roomId) {
  const room = await loadRoomFor(ctx, roomId);
  return prisma.user.findMany({ where: { id: { in: await roomUserIds(room) } }, select: { id: true, name: true, email: true, image: true }, orderBy: { name: 'asc' } });
}

/** Everyone else's delivered/read marks: the client turns them into ✓ / ✓✓ / blue ✓✓ on your own messages. */
export async function getReceipts(ctx, roomId) {
  const room = await loadRoomFor(ctx, roomId);
  const others = (await roomUserIds(room)).filter((id) => id !== ctx.currentUser.id);
  const [reads, deliveries] = await Promise.all([
    prisma.chatRead.findMany({ where: { roomId: room.id, userId: { in: others } } }),
    prisma.chatDelivery.findMany({ where: { roomId: room.id, userId: { in: others } } }),
  ]);
  const r = new Map(reads.map((x) => [x.userId, x.lastReadAt])), d = new Map(deliveries.map((x) => [x.userId, x.deliveredAt]));
  return others.map((userId) => ({ userId, readAt: r.get(userId) ?? null, deliveredAt: d.get(userId) ?? null }));
}

export async function markRead(ctx, roomId) {
  const room = await loadRoomFor(ctx, roomId);
  const me = ctx.currentUser.id;
  const now = new Date();
  await prisma.chatRead.upsert({ where: { roomId_userId: { roomId: room.id, userId: me } }, update: { lastReadAt: now }, create: { roomId: room.id, userId: me, lastReadAt: now } });
  hub.sendToUser(me, { type: 'chat.read', roomId: room.id }); // keeps other tabs' unread badges in sync
  emit(await roomUserIds(room), { type: 'chat.receipt', roomId: room.id, userId: me, kind: 'read', at: now }); // blue ticks for the senders
}

export async function sendTyping(ctx, roomId) {
  const room = await loadRoomFor(ctx, roomId);
  const me = ctx.currentUser.id;
  hub.sendToUsers((await roomUserIds(room)).filter((id) => id !== me), { type: 'chat.typing', roomId: room.id, userId: me, name: ctx.currentUser.name || ctx.currentUser.email });
}

export async function getOrCreateDm(ctx, otherId) {
  if (!ctx.isInternal) throw new AppError('Chat is available to Tendrils staff only', 403);
  const me = ctx.currentUser.id;
  if (!otherId || otherId === me) throw new AppError('Pick someone else to message', 400);
  await assertAssignable(otherId); // must be active internal staff
  const directKey = dmKey(me, otherId);
  const found = await prisma.chatRoom.findUnique({ where: { directKey } });
  if (found) return found;
  try {
    return await prisma.chatRoom.create({ data: { name: 'Direct message', type: 'DIRECT', directKey } });
  } catch (e) {
    if (e.code === 'P2002') return prisma.chatRoom.findUnique({ where: { directKey } }); // created concurrently
    throw e;
  }
}

export async function listRooms(ctx) {
  if (!ctx.isInternal) throw new AppError('Chat is available to Tendrils staff only', 403);
  const me = ctx.currentUser.id;
  if (!(await prisma.chatRoom.findFirst({ where: { type: 'GENERAL' }, select: { id: true } }))) {
    await prisma.chatRoom.create({ data: { name: 'General', type: 'GENERAL' } });
  }
  // Backfill rooms for projects that predate chat.
  const mine = ctx.isManager ? {} : { members: { some: { userId: me } } };
  const missing = await prisma.project.findMany({ where: { ...mine, chatRoom: null }, select: { id: true, name: true } });
  if (missing.length) await prisma.chatRoom.createMany({ data: missing.map((p) => ({ name: p.name, type: 'PROJECT', projectId: p.id })), skipDuplicates: true });

  const projectAccess = ctx.isManager ? {} : { project: { members: { some: { userId: me } } } };
  const rooms = await prisma.chatRoom.findMany({
    where: { OR: [{ type: 'GENERAL' }, { type: 'PROJECT', ...projectAccess }, { type: 'DIRECT', OR: [{ directKey: { startsWith: `${me}:` } }, { directKey: { endsWith: `:${me}` } }] }] },
    include: { project: { select: { id: true, name: true, organization: { select: { name: true } } } }, messages: { take: 1, orderBy: { createdAt: 'desc' }, include: authorSelect } },
  });
  const reads = new Map((await prisma.chatRead.findMany({ where: { userId: me } })).map((r) => [r.roomId, r.lastReadAt]));
  const dmUserIds = rooms.filter((r) => r.type === 'DIRECT').map((r) => participants(r).find((id) => id !== me));
  const dmUsers = new Map((await prisma.user.findMany({ where: { id: { in: dmUserIds } }, select: { id: true, name: true, email: true, image: true } })).map((u) => [u.id, u]));
  const since = (id) => reads.get(id) ?? ctx.currentUser.createdAt; // new members aren't flooded with old history

  return Promise.all(
    rooms.map(async ({ messages, ...r }) => {
      const dmUser = r.type === 'DIRECT' ? dmUsers.get(participants(r).find((id) => id !== me)) ?? null : null;
      return {
        ...r,
        name: dmUser ? dmUser.name || dmUser.email : r.name,
        dmUser,
        lastMessage: messages[0] ? publicMessage(messages[0]) : null,
        unread: await prisma.chatMessage.count({ where: { roomId: r.id, authorId: { not: me }, createdAt: { gt: since(r.id) } } }),
      };
    })
  );
}

/** When someone comes online, everything waiting for them counts as delivered (✓✓). Best-effort. */
export async function markDeliveredOnConnect(ctx) {
  if (!ctx.isInternal) return;
  const rooms = await listRoomsLite(ctx);
  const at = new Date();
  for (const room of rooms) {
    await prisma.chatDelivery.upsert({ where: { roomId_userId: { roomId: room.id, userId: ctx.currentUser.id } }, update: { deliveredAt: at }, create: { roomId: room.id, userId: ctx.currentUser.id, deliveredAt: at } });
    emit(await roomUserIds(room), { type: 'chat.receipt', roomId: room.id, userId: ctx.currentUser.id, kind: 'delivered', at });
  }
}

async function listRoomsLite(ctx) {
  const me = ctx.currentUser.id;
  const projectAccess = ctx.isManager ? {} : { project: { members: { some: { userId: me } } } };
  return prisma.chatRoom.findMany({
    where: { OR: [{ type: 'GENERAL' }, { type: 'PROJECT', ...projectAccess }, { type: 'DIRECT', OR: [{ directKey: { startsWith: `${me}:` } }, { directKey: { endsWith: `:${me}` } }] }] },
  });
}

/** Who has read / received one of MY messages (sender only). */
export async function messageInfo(ctx, messageId) {
  const { msg, room } = await loadMessageFor(ctx, messageId);
  if (msg.authorId !== ctx.currentUser.id) throw new AppError('Only the sender can see message info.', 403, 'INFO_SENDER_ONLY');
  const others = (await roomUserIds(room)).filter((id) => id !== ctx.currentUser.id);
  const [reads, deliveries, people] = await Promise.all([
    prisma.chatRead.findMany({ where: { roomId: room.id, userId: { in: others } } }),
    prisma.chatDelivery.findMany({ where: { roomId: room.id, userId: { in: others } } }),
    prisma.user.findMany({ where: { id: { in: others } }, select: { id: true, name: true, email: true, image: true } }),
  ]);
  return classifyReceipts(msg, people, new Map(reads.map((r) => [r.userId, r.lastReadAt])), new Map(deliveries.map((d) => [d.userId, d.deliveredAt])));
}
