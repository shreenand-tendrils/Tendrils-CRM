import crypto from 'node:crypto';

// Short-lived token for the WebSocket handshake. Needed because the WebSocket goes straight to the API host
// (Vercel cannot proxy WebSockets), so the session cookie of the frontend domain is not sent along.
const secret = () => process.env.AUTH_SECRET || 'dev-only-secret';
const sig = (v) => crypto.createHmac('sha256', secret()).update(`ws:${v}`).digest('base64url');

export function signWsToken(userId, ttlMs = 60_000) {
  const body = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${sig(body)}`;
}

export function verifyWsToken(token = '') {
  const [body, s] = String(token).split('.');
  if (!body || !s) return null;
  const a = Buffer.from(sig(body));
  const b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return u && e > Date.now() ? u : null;
  } catch {
    return null;
  }
}
