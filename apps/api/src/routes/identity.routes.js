import { Router } from 'express';
import { isManager } from '../middleware/index.js';
import { prisma } from '../db.js';
import { signWsToken } from '../services/wsToken.js';

const router = Router();
router.get('/me', (req, res) =>
  res.json({
    user: { id: req.currentUser.id, name: req.currentUser.name, email: req.currentUser.email, workEmail: req.currentUser.workEmail || null, image: req.currentUser.image },
    isInternal: req.isInternal,
    modes: req.modes || [],
    mode: req.mode || null,
    isManager: isManager(req),
    permissions: [...req.permissions],
    roles: [...new Set(req.memberships.map((m) => m.role))],
    teamIds: [...new Set(req.memberships.flatMap((m) => m.teamMemberships.map((x) => x.teamId)))],
    memberships: req.memberships.map((m) => ({
      id: m.id, role: m.role, organization: m.organization, teams: m.teamMemberships.map((x) => x.team.name),
    })),
  })
);
router.patch('/me/work-email', async (req, res) => {
  const v = String(req.body?.workEmail ?? '').trim().toLowerCase();
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return res.status(400).json({ error: 'Enter a valid email address.' });
  await prisma.user.update({ where: { id: req.currentUser.id }, data: { workEmail: v || null } });
  res.json({ workEmail: v || null });
});
router.get('/realtime/token', (req, res) => res.json({ token: signWsToken(req.currentUser.id) }));
export default router;
