// Pure chat rules (no database): easy to unit-test.
export const EDIT_WINDOW_MS = 15 * 60 * 1000; // like WhatsApp: edit within 15 minutes
export const MAX_PINS = 3;

export const canEditMessage = (msg, userId, now = Date.now()) =>
  msg.authorId === userId && !msg.deletedAt && now - new Date(msg.createdAt).getTime() <= EDIT_WINDOW_MS;
export const canDeleteMessage = (msg, ctx) => !msg.deletedAt && (msg.authorId === ctx.currentUser.id || ctx.isManager);

/**
 * Tick status of one of MY messages, from the other participants' receipts:
 * 'sent' (✓) | 'delivered' (✓✓ grey) | 'read' (✓✓ blue). Group messages turn blue only when EVERYONE has read them.
 * receipts: [{ deliveredAt, readAt }] for every participant except the author.
 */
export function tickStatus(message, receipts) {
  if (!receipts.length) return 'sent';
  const at = new Date(message.createdAt).getTime();
  const ts = (v) => (v ? new Date(v).getTime() : -Infinity);
  if (receipts.every((r) => ts(r.readAt) >= at)) return 'read';
  if (receipts.every((r) => Math.max(ts(r.deliveredAt), ts(r.readAt)) >= at)) return 'delivered';
  return 'sent';
}

/** Keep only mention ids that are real room participants, never yourself, de-duplicated. */
export const cleanMentions = (ids = [], roomUserIds = [], me) => [...new Set(ids)].filter((id) => id !== me && roomUserIds.includes(id));

/** What other clients are allowed to see of a message (deleted text never leaves the server). */
export const publicMessage = (m) => {
  const out = m.deletedAt ? { ...m, body: '', mentionIds: [] } : m;
  return out.replyTo?.deletedAt ? { ...out, replyTo: { ...out.replyTo, body: '' } } : out; // a quoted deleted message stays hidden
};

/** "@all" / "@everyone" anywhere in the text. Not available in direct messages. */
export const mentionsAll = (body = '') => /(^|\s)@(all|everyone)(?![\w])/i.test(body);
/** In #General only team leads and managers may ping everyone (avoids noise). */
export const canMentionAll = (ctx, room) => room.type !== 'DIRECT' && (room.type !== 'GENERAL' || ctx.isManager || ctx.can('task.assign'));

/**
 * Message info (like WhatsApp): who has read it, who just received it, who is still waiting.
 * readAt/deliveredAt are the person's per-room marks (last time they read / were online).
 */
export function classifyReceipts(message, people, readMap, deliveredMap) {
  const at = new Date(message.createdAt).getTime();
  const t = (v) => (v ? new Date(v).getTime() : -Infinity);
  const readBy = [], deliveredTo = [], pending = [];
  for (const u of people) {
    const r = readMap.get(u.id), d = deliveredMap.get(u.id);
    if (t(r) >= at) readBy.push({ user: u, at: r });
    else if (t(d) >= at) deliveredTo.push({ user: u, at: d });
    else pending.push(u);
  }
  return { readBy, deliveredTo, pending };
}
