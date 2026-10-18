import { prisma } from '../db.js';
import { parseCookies, devEmailFromCookieHeader } from '../services/devAuth.js';
import { loadContextByEmail } from '../services/session.js';

/** Resolve the logged-in user from the WebSocket upgrade request's cookies. */
export async function authenticateUpgrade(req) {
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
