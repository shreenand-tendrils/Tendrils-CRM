import { Router } from 'express';
import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { DEV_COOKIE, isDemoEmail, signDevToken, devEmailFromCookieHeader } from '../services/devAuth.js';
import { loadContextByEmail } from '../services/session.js';

// Mounted only when DEV_LOGIN=true and NODE_ENV !== 'production' (see routes/index.js).
const router = Router();
const cookieOpts = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 8 * 3600 * 1000 };

router.get('/status', (req, res) => res.json({ enabled: true, current: devEmailFromCookieHeader(req.headers.cookie) }));

router.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { email: { contains: '.demo@' }, memberships: { some: { isActive: true } } },
    select: { id: true, name: true, email: true, memberships: { where: { isActive: true }, select: { role: true, organization: { select: { name: true, type: true } } } } },
    orderBy: { name: 'asc' },
  });
  res.json(users.filter((u) => isDemoEmail(u.email)).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.memberships[0]?.role, organization: u.memberships[0]?.organization?.name, type: u.memberships[0]?.organization?.type })));
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase();
  if (!isDemoEmail(email)) throw new AppError('Only demo accounts can use dev login', 403);
  if (!(await loadContextByEmail(email))) throw new AppError('Demo user not found — run the demo seed first', 404);
  res.cookie(DEV_COOKIE, signDevToken(email), cookieOpts).json({ ok: true, email });
});

router.post('/logout', (_req, res) => res.clearCookie(DEV_COOKIE, { path: '/' }).json({ ok: true }));
export default router;
