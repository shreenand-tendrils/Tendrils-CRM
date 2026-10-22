import { Router } from 'express';
import { isManager } from '../middleware/index.js';
import { signWsToken } from '../services/wsToken.js';

const router = Router();
router.get('/me', (req, res) =>
  res.json({
    user: { id: req.currentUser.id, name: req.currentUser.name, email: req.currentUser.email, image: req.currentUser.image },
    isInternal: req.isInternal,
    isManager: isManager(req),
    permissions: [...req.permissions],
    roles: [...new Set(req.memberships.map((m) => m.role))],
    teamIds: [...new Set(req.memberships.flatMap((m) => m.teamMemberships.map((x) => x.teamId)))],
    memberships: req.memberships.map((m) => ({
      id: m.id, role: m.role, organization: m.organization, teams: m.teamMemberships.map((x) => x.team.name),
    })),
  })
);
router.get('/realtime/token', (req, res) => res.json({ token: signWsToken(req.currentUser.id) }));
export default router;
