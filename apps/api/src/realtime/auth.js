import { prisma } from '../db.js';
import { parseCookies, devEmailFromCookieHeader } from '../services/devAuth.js';
import { loadContextByEmail, loadContextByUserId } from '../services/session.js';
import { verifyWsToken } from '../services/wsToken.js';

/** Resolve the logged-in user from the WebSocket upgrade request's cookies. */
export async function authenticateUpgrade(req) {
  // Token flow (cross-domain deploys): /ws?token=...
  const qToken = new URL(req.url, 'http://x').searchParams.get('token');
  if (qToken) {
    const uid = verifyWsToken(qToken);
    return uid ? loadContextByUserId(uid) : null;
  }

  const header = req.headers.cookie || '';
  const dev = devEmailFromCookieHeader(header);
  if (dev) return loadContextByEmail(dev);

  const c = parseCookies(header);
  const token = c['__Secure-authjs.session-token'] || c['authjs.session-token'];
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { sessionToken: token }, include: { user: true } });
  if (!session || session.expires < new Date()) return null;
  const email = session.user.email?.toLowerCase();
  return email ? loadContextByEmail(email) : null; // membership decides access, not the email domain
}
