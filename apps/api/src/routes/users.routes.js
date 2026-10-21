import { Router } from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/index.js';

const router = Router();
router.get('/users', requirePermission('user.list'), async (_req, res) =>
  res.json(
    await prisma.user.findMany({
      where: { memberships: { some: { isActive: true, organization: { type: 'INTERNAL' } } } },
      select: {
        id: true, name: true, email: true, image: true,
        memberships: { where: { isActive: true }, select: { role: true, organization: { select: { name: true } } } },
      },
      orderBy: { name: 'asc' },
    })
  )
);
export default router;
