import { prisma } from '../../db.js';

/** Thin client for the WhatsApp Business Cloud API (Meta Graph). Every outbound message is logged in WhatsAppMessage. */
const cfg = () => ({ token: process.env.WHATSAPP_TOKEN, phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID, ver: process.env.WHATSAPP_GRAPH_VERSION || 'v23.0' });
export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
export const normalizePhone = (v) => String(v || '').replace(/\D/g, '').replace(/^00/, '');
export const maskPhone = (p) => (p ? `+${p.slice(0, Math.max(0, p.length - 8))} •••• ${p.slice(-3)}` : '');
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

async function graph(path, { method = 'POST', body, raw } = {}) {
  const { token, ver } = cfg();
  const res = await fetch(raw ? path : `https://graph.facebook.com/${ver}/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (raw === 'binary') { if (!res.ok) throw new Error(`Media download failed (${res.status})`); return res; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data?.error?.message || `WhatsApp API ${res.status}`); e.code = data?.error?.code; throw e; }
  return data;
}

async function log(row) { try { return await prisma.whatsAppMessage.create({ data: row }); } catch (e) { if (e.code !== 'P2002') console.error('[wa] log failed:', e.message); } }

async function deliver(to, kind, bodyText, payload, userId) {
  if (!whatsappConfigured()) throw new Error('WhatsApp is not configured');
  try {
    const r = await graph(`${cfg().phoneId}/messages`, { body: { messaging_product: 'whatsapp', to, ...payload } });
    await log({ waId: r.messages?.[0]?.id, direction: 'OUT', phone: to, userId, kind, body: clip(bodyText, 500), status: 'sent' });
    return r;
  } catch (e) {
    await log({ direction: 'OUT', phone: to, userId, kind, body: clip(bodyText, 500), status: 'failed', error: clip(e.message, 300) });
    throw e;
  }
}

export const sendText = (to, text, userId) => deliver(to, 'text', text, { type: 'text', text: { body: clip(text, 3800), preview_url: false } }, userId);

/** Up to 3 quick-reply buttons. */
export const sendButtons = (to, text, buttons, userId) => deliver(to, 'interactive', text, {
  type: 'interactive',
  interactive: { type: 'button', body: { text: clip(text, 1000) }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, 20) } })) } },
}, userId);

const tplParam = (v) => ({ type: 'text', text: clip(String(v).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-', 400) });
/** Template messages are the only thing WhatsApp allows outside the 24h customer-service window. */
export const sendTemplate = (to, name, params, userId, lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en') => deliver(to, 'template', `[${name}] ${params.join(' | ')}`, {
  type: 'template', template: { name, language: { code: lang }, components: [{ type: 'body', parameters: params.map(tplParam) }] },
}, userId);

export const markRead = (waId) => graph(`${cfg().phoneId}/messages`, { body: { messaging_product: 'whatsapp', status: 'read', message_id: waId } }).catch(() => {});

export async function downloadMedia(mediaId) {
  const meta = await graph(mediaId, { method: 'GET' });
  const res = await graph(meta.url, { method: 'GET', raw: 'binary' });
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: meta.mime_type };
}

export const inFreeWindow = (link, now = Date.now()) => Boolean(link?.windowOpenUntil && new Date(link.windowOpenUntil).getTime() > now);
