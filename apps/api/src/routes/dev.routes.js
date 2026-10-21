import { Router } from 'express';
import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { DEV_COOKIE, isDemoEmail, signDevToken, devEmailFromCookieHeader } from '../services/devAuth.js';
import { loadContextByEmail } from '../services/session.js';
import { CANONICAL_EMAILS } from '../services/demoPeople.js';

// Mounted only when DEV_LOGIN=true and NODE_ENV !== 'production' (see routes/index.js).
const router = Router();
const cookieOpts = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 8 * 3600 * 1000 };

router.get('/status', (req, res) => res.json({ enabled: true, current: devEmailFromCookieHeader(req.headers.cookie) }));

const ROLE_LABELS = { PLATFORM_ADMIN: 'Platform admin (Root / Boss)', EMPLOYEE: 'Employee', CLIENT_ADMIN: 'Client admin (Client boss)', CLIENT_MEMBER: 'Client member' };
const ROLE_ORDER = ['PLATFORM_ADMIN', 'EMPLOYEE', 'CLIENT_ADMIN', 'CLIENT_MEMBER'];

// Every demo account with its role label and teams, so the switcher shows WHO each person is.
router.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { email: { contains: '.demo@' }, memberships: { some: { isActive: true } } },
    select: {
      id: true, name: true, email: true,
      memberships: { where: { isActive: true }, select: { role: true, organization: { select: { name: true, type: true } }, teamMemberships: { select: { team: { select: { name: true } } } } } },
    },
    orderBy: { name: 'asc' },
  });
  const rows = users.filter((u) => isDemoEmail(u.email)).map((u) => {
    const m = u.memberships.find((x) => x.organization?.type === 'INTERNAL') || u.memberships[0];
    return {
      id: u.id, name: u.name, email: u.email, role: m?.role, roleLabel: ROLE_LABELS[m?.role] || m?.role,
      organization: m?.organization?.name, type: m?.organization?.type,
      teams: (m?.teamMemberships || []).map((tm) => tm.team.name).sort(),
    };
  });
  // Safety net: one row per person. If the same name appears twice, keep the seeded (canonical) account.
  const best = new Map();
  for (const r of rows) {
    const k = String(r.name || r.email).trim().toLowerCase();
    const cur = best.get(k);
    if (!cur || (!CANONICAL_EMAILS.has(cur.email.toLowerCase()) && CANONICAL_EMAILS.has(r.email.toLowerCase()))) best.set(k, r);
  }
  rows.length = 0; rows.push(...best.values());
  rows.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || String(a.name).localeCompare(String(b.name)));
  res.json(rows);
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase();
  if (!isDemoEmail(email)) throw new AppError('Only demo accounts can use dev login', 403);
  if (!(await loadContextByEmail(email))) throw new AppError('Demo user not found — run the demo seed first', 404);
  res.cookie(DEV_COOKIE, signDevToken(email), cookieOpts).json({ ok: true, email });
});

router.post('/logout', (_req, res) => res.clearCookie(DEV_COOKIE, { path: '/' }).json({ ok: true }));
export default router;
