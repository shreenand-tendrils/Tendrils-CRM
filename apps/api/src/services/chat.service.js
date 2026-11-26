import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { hub } from '../realtime/hub.js';
import { STAFF_ROLES, MANAGER_ROLES } from './session.js';
import { assertAssignable } from './guards.js';
import { notifyUser } from './activity.js';
import { sendMentionEmail, fireAndLog } from './email.service.js';
import { loadVisibleTicket } from './tickets.service.js';
import { createTask } from './tasks.service.js';
import { canEditMessage, canDeleteMessage, cleanMentions, publicMessage, MAX_PINS, mentionsAll, canMentionAll, classifyReceipts, REACTION_EMOJIS } from './chatLogic.js';

// ctx = { currentUser, memberships, isInternal, isManager }
// Chat is staff-only. GENERAL: all staff. PROJECT: project members + managers. DIRECT: the two participants.
const authorSelect = { author: { select: { id: true, name: true, email: true, image: true } } };
// A message with its author and the (short) message it replies to.
export const messageInclude = { ...authorSelect, reactions: { select: { userId: true, emoji: true }, orderBy: { createdAt: 'asc' } }, attachments: { select: { id: true, originalName: true, mimeType: true, size: true } }, replyTo: { select: { id: true, body: true, deletedAt: true, authorId: true, author: { select: { id: true, name: true, email: true } } } } };
export const dmKey = (a, b) => [a, b].sort().join(':');
const participants = (room) => room.directKey?.split(':') ?? [];
const uniq = (rows) => [...new Set(rows.map((r) => r.userId))];

export async function loadRoomFor(ctx, roomId) {
  if (!ctx.isInternal) throw new AppError('Chat is available to Tendrils staff only', 403);
  const room = roomId ? await prisma.chatRoom.findUnique({ where: { id: roomId } }) : null;
  if (!room) throw new AppError('Room not found', 404);
  if (room.type === 'DIRECT' && !participants(room).includes(ctx.currentUser.id)) throw new AppError('Room not found', 404);
  if (room.type === 'TICKET' && !ctx.isManager && !(await roomUserIds(room)).includes(ctx.currentUser.id)) throw new AppError('Room not found', 404);
  if (room.type === 'PROJECT' && !ctx.isManager) {
    const m = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: room.projectId, userId: ctx.currentUser.id } } });
    if (!m) throw new AppError('Room not found', 404);
  }
  return room;
}

export async function roomUserIds(room) {
  if (room.type === 'DIRECT') return participants(room);
  if (room.type === 'TICKET') return ticketRoomUserIds(room);
  const internal = { isActive: true, organization: { type: 'INTERNAL' } };
  if (room.type === 'GENERAL') return uniq(await prisma.membership.findMany({ where: { ...internal, role: { in: STAFF_ROLES } }, select: { userId: true } }));
  const [members, managers] = await Promise.all([
    prisma.projectMember.findMany({ where: { projectId: room.projectId }, select: { userId: true } }),
    prisma.membership.findMany({ where: { ...internal, role: { in: MANAGER_ROLES } }, select: { userId: true } }),
  ]);
  return uniq([...members, ...managers]);
}

/** The people actually on the ticket: requester, assignee, collaborators plus anyone invited. Staff only. */
async function ticketCoreUserIds(room) {
  const [t, members] = await Promise.all([
    prisma.ticket.findUnique({ where: { id: room.ticketId }, select: { requesterId: true, assigneeId: true, collaborators: { select: { userId: true } } } }),
    prisma.chatRoomMember.findMany({ where: { roomId: room.id }, select: { userId: true } }),
  ]);
  const ids = [...new Set([t?.requesterId, t?.assigneeId, ...(t?.collaborators || []).map((c) => c.userId), ...members.map((m) => m.userId)].filter(Boolean))];
  if (!ids.length) return [];
  return uniq(await prisma.membership.findMany({ where: { userId: { in: ids }, isActive: true, organization: { type: 'INTERNAL' } }, select: { userId: true } }));
}
/** Platform admins are part of EVERY ticket discussion (they see it, get its messages and can be mentioned). */
async function platformAdminIds() {
  return uniq(await prisma.membership.findMany({ where: { role: 'PLATFORM_ADMIN', isActive: true, organization: { type: 'INTERNAL' } }, select: { userId: true } }));
}
async function ticketRoomUserIds(room) {
  const [core, admins] = await Promise.all([ticketCoreUserIds(room), platformAdminIds()]);
  return [...new Set([...core, ...admins])];
}
/** Read/delivered ticks only wait for the people on the ticket, so a silent admin never keeps a message from turning blue. */
async function receiptUserIds(room) {
  return room.type === 'TICKET' ? ticketCoreUserIds(room) : roomUserIds(room);
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
  const where = room.type === 'DIRECT' ? 'a direct message' : room.type === 'GENERAL' ? '#General' : room.type === 'TICKET' ? `the discussion on ${room.name.split(' · ')[0]}` : room.name;
  for (const u of users) {
    const href = `/chat?room=${room.id}`;
    await notifyUser({ userId: u.id, type: 'MENTION', title: everyone ? `${by} mentioned everyone in ${where}` : `${by} mentioned you in ${where}`, body: snippet(body), href });
    if (!hub.isOnline(u.id) && u.email) fireAndLog(sendMentionEmail({ to: u.email, name: u.name, byName: by, roomName: where, snippet: snippet(body), href }));
  }
}

export async function sendMessage(ctx, roomId, body, mentionIds = [], replyToId = null, attachmentIds = []) {
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
  let message = await prisma.chatMessage.create({ data: { roomId: room.id, authorId: me, body, mentionIds: mentions, replyToId: replyToId || null }, include: messageInclude });
  if (attachmentIds.length) { // files uploaded to this room by me and not yet used: they travel with this message
    await prisma.attachment.updateMany({ where: { id: { in: attachmentIds }, chatRoomId: room.id, uploadedById: me, chatMessageId: null }, data: { chatMessageId: message.id } });
    message = await prisma.chatMessage.findUnique({ where: { id: message.id }, include: messageInclude });
  }
  await prisma.chatRead.upsert({
    where: { roomId_userId: { roomId: room.id, userId: me } },
    update: { lastReadAt: message.createdAt },
    create: { roomId: room.id, userId: me, lastReadAt: message.createdAt },
  });
  if (room.resolvedAt) { await prisma.chatRoom.update({ where: { id: room.id }, data: { resolvedAt: null } }); emit(userIds, { type: 'chat.room.updated', roomId: room.id }); } // a new message reopens it
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
  const others = (await receiptUserIds(room)).filter((id) => id !== ctx.currentUser.id);
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

const ticketRoomAccess = (me, isManager = false) => isManager ? {} : ({ OR: [{ members: { some: { userId: me } } }, { ticket: { requesterId: me } }, { ticket: { assigneeId: me } }, { ticket: { collaborators: { some: { userId: me } } } }] });

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
    where: { OR: [{ type: 'GENERAL' }, { type: 'PROJECT', ...projectAccess }, { type: 'TICKET', ...ticketRoomAccess(me, ctx.isManager) }, { type: 'DIRECT', OR: [{ directKey: { startsWith: `${me}:` } }, { directKey: { endsWith: `:${me}` } }] }] },
    include: { project: { select: { id: true, name: true, organization: { select: { name: true } } } }, ticket: { select: { id: true, key: true, title: true, status: true } }, messages: { take: 1, orderBy: { createdAt: 'desc' }, include: authorSelect } },
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
        name: dmUser ? dmUser.name || dmUser.email : r.type === 'TICKET' && r.ticket ? `${r.ticket.key} · ${r.ticket.title}` : r.name,
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
    where: { OR: [{ type: 'GENERAL' }, { type: 'PROJECT', ...projectAccess }, { type: 'TICKET', ...ticketRoomAccess(me, ctx.isManager) }, { type: 'DIRECT', OR: [{ directKey: { startsWith: `${me}:` } }, { directKey: { endsWith: `:${me}` } }] }] },
  });
}

/** Who has read / received one of MY messages (sender only). */
export async function messageInfo(ctx, messageId) {
  const { msg, room } = await loadMessageFor(ctx, messageId);
  if (msg.authorId !== ctx.currentUser.id) throw new AppError('Only the sender can see message info.', 403, 'INFO_SENDER_ONLY');
  const others = (await receiptUserIds(room)).filter((id) => id !== ctx.currentUser.id);
  const [reads, deliveries, people] = await Promise.all([
    prisma.chatRead.findMany({ where: { roomId: room.id, userId: { in: others } } }),
    prisma.chatDelivery.findMany({ where: { roomId: room.id, userId: { in: others } } }),
    prisma.user.findMany({ where: { id: { in: others } }, select: { id: true, name: true, email: true, image: true } }),
  ]);
  return classifyReceipts(msg, people, new Map(reads.map((r) => [r.userId, r.lastReadAt])), new Map(deliveries.map((d) => [d.userId, d.deliveredAt])));
}

// ---------- ticket discussion rooms ----------

/** The live discussion for one ticket: created the first time someone opens it. The opener is added so it shows in their chat list. */
export async function openTicketRoom(ctx, ticketId) {
  if (!ctx.isInternal) throw new AppError('Chat is available to Tendrils staff only', 403);
  const t = await loadVisibleTicket(ctx, ticketId); // 404 when this person cannot see the ticket
  let room = await prisma.chatRoom.findUnique({ where: { ticketId: t.id } });
  if (!room) {
    try { room = await prisma.chatRoom.create({ data: { name: `${t.key} · ${t.title}`, type: 'TICKET', ticketId: t.id } }); }
    catch (e) { if (e.code === 'P2002') room = await prisma.chatRoom.findUnique({ where: { ticketId: t.id } }); else throw e; }
  }
  const me = ctx.currentUser.id;
  await prisma.chatRoomMember.upsert({ where: { roomId_userId: { roomId: room.id, userId: me } }, update: {}, create: { roomId: room.id, userId: me, addedById: me } });
  return room;
}

/** Light summary for the ticket window: unread count, pinned decisions, resolved state. */
export async function ticketDiscussionSummary(ctx, ticketId) {
  if (!ctx.isInternal) throw new AppError('Chat is available to Tendrils staff only', 403);
  const t = await loadVisibleTicket(ctx, ticketId);
  const room = await prisma.chatRoom.findUnique({ where: { ticketId: t.id } });
  if (!room) return { roomId: null, messages: 0, unread: 0, pinned: [], resolvedAt: null, members: 0 };
  const me = ctx.currentUser.id;
  const read = await prisma.chatRead.findUnique({ where: { roomId_userId: { roomId: room.id, userId: me } } });
  const [messages, unread, pinned, members] = await Promise.all([
    prisma.chatMessage.count({ where: { roomId: room.id, deletedAt: null } }),
    prisma.chatMessage.count({ where: { roomId: room.id, authorId: { not: me }, deletedAt: null, createdAt: { gt: read?.lastReadAt ?? new Date(0) } } }),
    prisma.chatMessage.findMany({ where: { roomId: room.id, pinnedAt: { not: null }, deletedAt: null }, orderBy: { pinnedAt: 'desc' }, take: 3, include: messageInclude }),
    roomUserIds(room).then((ids) => ids.length),
  ]);
  return { roomId: room.id, messages, unread, pinned: pinned.map(publicMessage), resolvedAt: room.resolvedAt, members };
}

/** Bring people (or whole teams) into a ticket discussion. They get a notification and the room appears in their chat. */
export async function inviteToRoom(ctx, roomId, { userIds = [], teamIds = [] } = {}) {
  const room = await loadRoomFor(ctx, roomId);
  if (room.type !== 'TICKET') throw new AppError('You can only invite people to a ticket discussion.', 400, 'INVITE_TICKET_ONLY');
  let ids = [...new Set(userIds.map(String))];
  if (teamIds.length) {
    const rows = await prisma.teamMember.findMany({ where: { teamId: { in: teamIds.map(String) }, membership: { isActive: true, organization: { type: 'INTERNAL' } } }, select: { membership: { select: { userId: true } } } });
    ids.push(...rows.map((r) => r.membership.userId));
  }
  const already = new Set(await roomUserIds(room));
  const valid = uniq(await prisma.membership.findMany({ where: { userId: { in: [...new Set(ids)] }, isActive: true, organization: { type: 'INTERNAL' } }, select: { userId: true } })).filter((id) => !already.has(id));
  if (!valid.length) return { added: [] };
  await prisma.chatRoomMember.createMany({ data: valid.map((userId) => ({ roomId: room.id, userId, addedById: ctx.currentUser.id })), skipDuplicates: true });
  const by = ctx.currentUser.name || ctx.currentUser.email;
  const key = room.name.split(' · ')[0];
  const users = await prisma.user.findMany({ where: { id: { in: valid } }, select: { id: true, name: true, email: true } });
  for (const u of users) {
    const href = `/chat?room=${room.id}`;
    await notifyUser({ userId: u.id, type: 'MENTION', title: `${by} added you to the discussion on ${key}`, body: room.name, href }).catch(() => {});
    if (!hub.isOnline(u.id) && u.email) fireAndLog(sendMentionEmail({ to: u.email, name: u.name, byName: by, roomName: `the discussion on ${key}`, snippet: room.name, href }));
  }
  emit([...already, ...valid], { type: 'chat.room.updated', roomId: room.id });
  return { added: users.map((u) => ({ id: u.id, name: u.name || u.email })) };
}

/** Mark a discussion resolved (or reopen it). A new message also reopens it. */
export async function setRoomResolved(ctx, roomId, resolved) {
  const room = await loadRoomFor(ctx, roomId);
  if (room.type !== 'TICKET') throw new AppError('Only ticket discussions can be resolved.', 400, 'RESOLVE_TICKET_ONLY');
  const updated = await prisma.chatRoom.update({ where: { id: room.id }, data: { resolvedAt: resolved ? new Date() : null } });
  emit(await roomUserIds(room), { type: 'chat.room.updated', roomId: room.id });
  return updated;
}

/** Turn a discussion message into a task on the same ticket. */
export async function messageToTask(ctx, messageId) {
  const { msg, room } = await loadMessageFor(ctx, messageId);
  if (room.type !== 'TICKET') throw new AppError('Tasks can be created from ticket discussions only.', 400, 'TASK_TICKET_ONLY');
  if (msg.deletedAt) throw new AppError('This message was deleted.', 400);
  const t = await loadVisibleTicket(ctx, room.ticketId);
  const firstLine = msg.body.split('\n')[0].trim();
  const title = (firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine).padEnd(2, '.');
  const task = await createTask(ctx, {
    title, description: msg.body, organizationId: t.organizationId, ticketId: t.id, projectId: t.projectId || undefined,
    priority: 'MEDIUM', status: 'TODO',
  });
  await sendMessage(ctx, room.id, `Created task "${task.title}" from this discussion.`, [], msg.id).catch(() => {});
  return task;
}

// ---------- reactions, search, files ----------

/** Add or remove my emoji reaction on a message. Everyone in the room sees the update live. */
export async function toggleReaction(ctx, messageId, emoji) {
  if (!REACTION_EMOJIS.includes(emoji)) throw new AppError('That reaction is not available.', 400, 'REACTION_NOT_ALLOWED');
  const { msg, room } = await loadMessageFor(ctx, messageId);
  if (msg.deletedAt) throw new AppError('This message was deleted.', 400);
  const key = { messageId: msg.id, userId: ctx.currentUser.id, emoji };
  const had = await prisma.chatReaction.findUnique({ where: { messageId_userId_emoji: key } });
  if (had) await prisma.chatReaction.delete({ where: { messageId_userId_emoji: key } });
  else await prisma.chatReaction.create({ data: key });
  const message = await prisma.chatMessage.findUnique({ where: { id: msg.id }, include: messageInclude });
  await broadcastUpdate(room, message);
  return publicMessage(message);
}

/** Search one room's messages (newest first, max 30). */
export async function searchMessages(ctx, roomId, q) {
  const room = await loadRoomFor(ctx, roomId);
  const term = String(q || '').trim().slice(0, 100);
  if (term.length < 2) return [];
  const rows = await prisma.chatMessage.findMany({ where: { roomId: room.id, deletedAt: null, body: { contains: term, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, take: 30, include: messageInclude });
  return rows.map(publicMessage);
}

/** Every file shared in this room (for the Files panel). */
export async function roomFiles(ctx, roomId) {
  const room = await loadRoomFor(ctx, roomId);
  return prisma.attachment.findMany({
    where: { chatRoomId: room.id, chatMessageId: { not: null }, chatMessage: { deletedAt: null } },
    orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadedById: true, chatMessageId: true },
  });
}

/** After a file is deleted from a message, tell everyone in the room so the message refreshes. */
export async function refreshMessage(messageId) {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, include: messageInclude });
  if (!message) return;
  const room = await prisma.chatRoom.findUnique({ where: { id: message.roomId } });
  if (room) await broadcastUpdate(room, message);
}
