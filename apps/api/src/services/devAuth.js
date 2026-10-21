import crypto from 'node:crypto';

// Development-only "login as" for testing user / client / admin views.
// Enabled ONLY when DEV_LOGIN=true and NODE_ENV !== 'production', and ONLY for
// seeded demo accounts (emails like name.demo@...). Never active in production.
export const DEV_COOKIE = 'tendrils_dev';
export const isDevLoginEnabled = () => process.env.DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production';
export const isDemoEmail = (e = '') => /^[a-z0-9._-]+\.demo@[a-z0-9.-]+$/i.test(e);

const sig = (v) => crypto.createHmac('sha256', process.env.AUTH_SECRET || 'dev-only-secret').update(v).digest('base64url');

export function signDevToken(email) {
  const b = Buffer.from(email.toLowerCase()).toString('base64url');
  return `${b}.${sig(b)}`;
}

export function verifyDevToken(token = '') {
  const [b, s] = token.split('.');
  if (!b || !s) return null;
  const expected = Buffer.from(sig(b));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return Buffer.from(b, 'base64url').toString();
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Returns the demo email from a valid dev cookie, or null (always null when dev login is off). */
export function devEmailFromCookieHeader(header) {
  if (!isDevLoginEnabled()) return null;
  const email = verifyDevToken(parseCookies(header)[DEV_COOKIE]);
  return email && isDemoEmail(email) ? email : null;
}
