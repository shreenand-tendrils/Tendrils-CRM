import { parseBody } from '../validators/validate.js';
import { chatMessageCreate } from '../validators/schemas.js';
import { loadContextByUserId } from '../services/session.js';
import { AppError } from '../errors/AppError.js';
import { sendMessage, markRead, sendTyping } from '../services/chat.service.js';

// Re-load permissions on every action so revoked access takes effect immediately.
async function fresh(ctx) {
  const c = await loadContextByUserId(ctx.currentUser.id);
  if (!c) throw new AppError('Your account is no longer active', 403);
  return c;
}

export const handlers = {
  ping: async (_ctx, _msg, reply) => reply({ type: 'pong' }),
  'chat.send': async (ctx, msg, reply) => {
    const { body, mentionIds, replyToId } = parseBody(chatMessageCreate, { body: msg.body, mentionIds: msg.mentionIds, replyToId: msg.replyToId || undefined });
    const m = await sendMessage(await fresh(ctx), String(msg.roomId || ''), body, mentionIds, replyToId);
    reply({ type: 'chat.ack', tempId: msg.tempId, messageId: m.id });
  },
  'chat.typing': async (ctx, msg) => sendTyping(await fresh(ctx), String(msg.roomId || '')),
  'chat.read': async (ctx, msg) => markRead(await fresh(ctx), String(msg.roomId || '')),
};
