import crypto from 'node:crypto';
import { prisma } from '../db.js';

// Personal access tokens (PAT). Used ONLY by the MCP endpoint. Raw token is shown once; only its sha256 is stored.
export const TOKEN_PREFIX = 'tdl_';
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export function newToken() {
  const raw = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, 10) };
}
export const bearerOf = (header) => /^Bearer\s+(tdl_[A-Za-z0-9_-]{20,})$/.exec(header || '')?.[1] || null;

/** -> { userId, tokenId, readOnly } or null (unknown / revoked / expired). */
export async function authenticateBearer(header) {
  const raw = bearerOf(header);
  if (!raw) return null;
  const t = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!t || t.revokedAt || (t.expiresAt && t.expiresAt < new Date())) return null;
  if (!t.lastUsedAt || Date.now() - new Date(t.lastUsedAt).getTime() > 60000) {
    prisma.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { userId: t.userId, tokenId: t.id, readOnly: (t.scopes || []).includes('read') };
}
