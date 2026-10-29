import crypto from 'node:crypto';

/**
 * "Acting as a user" without a browser session.
 * WhatsApp and MCP never touch the database rules directly: they call OUR OWN REST API in-process
 * (loopback to our own port; set INTERNAL_API_URL to the public API URL when running without a listening port, e.g. Lambda)
 * with a short-lived HMAC-signed header naming the user.
 * Result: RBAC, validation, notifications, ticket<->task sync and audit logging are identical to the web app.
 */
export const INTERNAL_HEADER = 'x-tendrils-internal';
const key = () => crypto.createHash('sha256').update(`tendrils-internal:${process.env.INTERNAL_API_SECRET || process.env.AUTH_SECRET || 'dev-insecure-secret'}`).digest();
const mac = (payload) => crypto.createHmac('sha256', key()).update(payload).digest('base64url');

export function signInternal(userId, ttlSec = 60, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  const payload = `${userId}.${exp}`;
  return `${payload}.${mac(payload)}`;
}
/** -> userId or null */
export function verifyInternal(token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const want = Buffer.from(mac(`${userId}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  if (Number(exp) < Math.floor(now / 1000)) return null;
  return userId;
}

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

let base = null;
/** Call once the HTTP server is listening, so in-process calls know the loopback port. */
export const bindServer = (server) => { base = `http://127.0.0.1:${server.address().port}`; };

export async function callAs(userId, method, path, { query, body } = {}) {
  const root = (process.env.INTERNAL_API_URL || base || '').replace(/\/$/, '');
  if (!root) throw new Error('Internal API is not ready');
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null))}` : '';
  const res = await fetch(`${root}/api/v1${path}${qs}`, {
    method, signal: AbortSignal.timeout(25000),
    headers: { [INTERNAL_HEADER]: signInternal(userId), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, data?.error || data?.message || `Request failed (${res.status})`, data?.code);
  return data;
}

/** A small client bound to one user. */
export const apiFor = (userId) => ({
  userId,
  get: (path, query) => callAs(userId, 'GET', path, { query }),
  post: (path, body) => callAs(userId, 'POST', path, { body: body ?? {} }),
  patch: (path, body) => callAs(userId, 'PATCH', path, { body: body ?? {} }),
  put: (path, body) => callAs(userId, 'PUT', path, { body: body ?? {} }),
  del: (path) => callAs(userId, 'DELETE', path),
});
