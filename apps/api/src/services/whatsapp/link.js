import crypto from 'node:crypto';
import { prisma } from '../../db.js';
import { normalizePhone } from './cloud.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const sha = (s) => crypto.createHash('sha256').update(String(s).trim().toUpperCase()).digest('hex');
export const LINK_TTL_MIN = 15;
export const DEFAULT_NOTIFY_TYPES = ['ASSIGNMENT', 'MENTION', 'APPROVAL', 'DUE_SOON', 'OVERDUE', 'SYSTEM', 'STATUS_CHANGE'];
export const ALL_NOTIFY_TYPES = ['ASSIGNMENT', 'MENTION', 'COMMENT', 'STATUS_CHANGE', 'APPROVAL', 'DUE_SOON', 'OVERDUE', 'SYSTEM'];
export const effectiveTypes = (link) => (link?.notifyTypes?.length ? link.notifyTypes : DEFAULT_NOTIFY_TYPES);

export const newCode = () => `TDL-${Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
export const extractCode = (text) => /^\s*link\s+(TDL-[A-Z2-9]{6})\s*$/i.exec(text || '')?.[1]?.toUpperCase() || null;

export function deepLink(code) {
  const n = normalizePhone(process.env.WHATSAPP_BUSINESS_NUMBER);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(`LINK ${code}`)}` : null;
}

/** Issue a one-time code. The number is proven when the user sends it FROM their phone to the business number. */
export async function startLink(userId) {
  const code = newCode();
  const expiresAt = new Date(Date.now() + LINK_TTL_MIN * 60000);
  await prisma.whatsAppLink.upsert({
    where: { userId }, create: { userId, codeHash: sha(code), codeExpiresAt: expiresAt }, update: { codeHash: sha(code), codeExpiresAt: expiresAt },
  });
  return { code, expiresAt, deepLink: deepLink(code) };
}

/** Called for an inbound "LINK TDL-XXXXXX" from an unknown number. */
export async function completeLink(phone, code) {
  const link = await prisma.whatsAppLink.findFirst({ where: { codeHash: sha(code), codeExpiresAt: { gt: new Date() } }, include: { user: { select: { id: true, name: true, email: true } } } });
  if (!link) return { ok: false, reason: 'expired' };
  const taken = await prisma.whatsAppLink.findUnique({ where: { phone } });
  if (taken && taken.userId !== link.userId) return { ok: false, reason: 'taken' };
  const updated = await prisma.whatsAppLink.update({
    where: { id: link.id }, data: { phone, status: 'ACTIVE', codeHash: null, codeExpiresAt: null, verifiedAt: new Date(), windowOpenUntil: new Date(Date.now() + 86400000), context: null },
  });
  return { ok: true, link: { ...updated, user: link.user } };
}

export const findActiveByPhone = (phone) => prisma.whatsAppLink.findFirst({ where: { phone, status: 'ACTIVE' }, include: { user: { select: { id: true, name: true, email: true } } } });
export const unlink = (userId) => prisma.whatsAppLink.deleteMany({ where: { userId } });
