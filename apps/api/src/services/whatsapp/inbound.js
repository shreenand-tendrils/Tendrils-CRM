import crypto from 'node:crypto';
import { prisma } from '../../db.js';
import * as cloud from './cloud.js';
import { extractCode, completeLink, findActiveByPhone } from './link.js';
import { handleLinkedMessage } from './bot.js';
import { apiFor } from '../internalApi.js';

/** X-Hub-Signature-256 check (HMAC-SHA256 of the RAW body with the Meta App Secret). */
export function verifySignature(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;
  const want = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const got = Buffer.from(String(header));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Meta payload -> { messages: [...], statuses: [...] } (pure, tested). */
export function parseWebhook(payload) {
  const messages = [], statuses = [];
  for (const entry of payload?.entry || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
    for (const m of v.messages || []) {
      const media = m.image || m.document || null;
      messages.push({
        from: cloud.normalizePhone(m.from), waId: m.id, type: m.type, profileName: names[m.from],
        text: m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : undefined,
        buttonId: m.interactive?.button_reply?.id || m.interactive?.list_reply?.id,
        media: media ? { id: media.id, mime: media.mime_type, filename: media.filename } : null,
        caption: media?.caption || '',
      });
    }
    for (const s of v.statuses || []) statuses.push({ waId: s.id, status: s.status, to: s.recipient_id, error: s.errors?.[0]?.title || s.errors?.[0]?.message });
  }
  return { messages, statuses };
}

// --- tiny in-memory guards (single instance; swap for Redis when scaling out) ---
const chains = new Map();   // phone -> promise (serialise one user's messages so context never races)
const hits = new Map();     // phone -> [timestamps]
const nudged = new Map();   // unknown phone -> last reply time
const tooMany = (phone, now = Date.now()) => {
  const arr = (hits.get(phone) || []).filter((t) => now - t < 5 * 60000);
  arr.push(now); hits.set(phone, arr);
  return arr.length > 40;
};
const serial = (phone, fn) => {
  const next = (chains.get(phone) || Promise.resolve()).catch(() => {}).then(fn);
  chains.set(phone, next);
  next.finally(() => chains.get(phone) === next && chains.delete(phone));
  return next;
};

async function setStatus(statuses) {
  for (const s of statuses) {
    await prisma.whatsAppMessage.updateMany({ where: { waId: s.waId }, data: { status: s.status, ...(s.error ? { error: String(s.error).slice(0, 300) } : {}) } }).catch(() => {});
  }
}

export async function handleInbound(msg, deps = {}) {
  const send = deps.sendText || cloud.sendText;
  const sendButtons = deps.sendButtons || cloud.sendButtons;
  // Idempotency: Meta retries webhooks. A repeated wamid is dropped here.
  try {
    await prisma.whatsAppMessage.create({ data: { waId: msg.waId, direction: 'IN', phone: msg.from, kind: msg.type, body: msg.media ? `[${msg.type}] ${msg.caption || ''}`.slice(0, 200) : (msg.text || msg.buttonId || '').slice(0, 200), status: 'received' } });
  } catch (e) { if (e.code === 'P2002') return 'duplicate'; throw e; }
  if (!deps.noMarkRead) cloud.markRead(msg.waId);
  if (tooMany(msg.from)) return 'rate-limited';

  return serial(msg.from, async () => {
    // 1) link handshake from an unknown number
    const code = extractCode(msg.text);
    if (code) {
      const r = await completeLink(msg.from, code);
      if (!r.ok) { await send(msg.from, r.reason === 'taken' ? 'This number is already linked to another Tendrils account. Unlink it there first.' : '⚠️ That code is invalid or expired. Generate a new one in Tendrils → Settings → WhatsApp.'); return 'link-failed'; }
      const api = apiFor(r.link.user.id);
      const me = await api.get('/me').catch(() => null);
      await send(msg.from, `✅ Linked! Welcome ${r.link.user.name || ''}.\n\nSend *help* to see what you can do here.`.replace('  ', ' '), r.link.user.id);
      if (me) await prisma.whatsAppMessage.updateMany({ where: { waId: msg.waId }, data: { userId: r.link.user.id, status: 'handled' } });
      return 'linked';
    }
    // 2) known user?
    const link = await findActiveByPhone(msg.from);
    if (!link) {
      if (Date.now() - (nudged.get(msg.from) || 0) > 3600e3) {
        nudged.set(msg.from, Date.now());
        await send(msg.from, 'This number is not linked to a Tendrils account yet. Open Tendrils → Settings → WhatsApp and tap "Link WhatsApp".');
      }
      return 'unknown-sender';
    }
    // 3) refresh the 24h free-messaging window, then run the command
    await prisma.whatsAppLink.update({ where: { id: link.id }, data: { windowOpenUntil: new Date(Date.now() + 86400000) } });
    link.windowOpenUntil = new Date(Date.now() + 86400000);
    const io = { say: (t) => send(msg.from, t, link.userId), buttons: (t, b) => sendButtons(msg.from, t, b, link.userId).catch(() => send(msg.from, `${t}\n\nReply *yes* or *no*.`, link.userId)) };
    try {
      await handleLinkedMessage({ link, msg, api: apiFor(link.userId), io, deps });
      await prisma.whatsAppMessage.updateMany({ where: { waId: msg.waId }, data: { userId: link.userId, status: 'handled' } });
    } catch (e) {
      console.error('[wa] handler failed:', e.message);
      await prisma.whatsAppMessage.updateMany({ where: { waId: msg.waId }, data: { userId: link.userId, status: 'error', error: e.message.slice(0, 300) } }).catch(() => {});
      await send(msg.from, 'Something went wrong on our side. Please try again in a moment.', link.userId).catch(() => {});
    }
    return 'handled';
  });
}

export async function processWebhook(payload, deps) {
  const { messages, statuses } = parseWebhook(payload);
  await setStatus(statuses);
  for (const m of messages) {
    if (!['text', 'image', 'document', 'interactive', 'button'].includes(m.type)) continue; // audio/location/etc: ignored for now
    await handleInbound(m, deps).catch((e) => console.error('[wa] inbound failed:', e.message));
  }
  return { messages: messages.length, statuses: statuses.length };
}
