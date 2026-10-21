import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();
router.get('/notifications', async (req, res) =>
  res.json(await prisma.notification.findMany({ where: { userId: req.currentUser.id }, orderBy: { createdAt: 'desc' }, take: 50 }))
);
router.patch('/notifications/:id/read', async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!n || n.userId !== req.currentUser.id) return res.status(404).json({ error: 'Notification not found' });
  res.json(await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } }));
});
router.post('/notifications/read-all', async (req, res) => {
  const r = await prisma.notification.updateMany({ where: { userId: req.currentUser.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: r.count });
});
export default router;
