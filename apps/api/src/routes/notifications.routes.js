import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();
router.get('/notifications', async (req, res) => {
  // Housekeeping so the list never grows forever: read items older than 14 days and anything older than 60 days are dropped.
  const day = 864e5;
  prisma.notification.deleteMany({ where: { userId: req.currentUser.id, OR: [{ readAt: { not: null }, createdAt: { lt: new Date(Date.now() - 14 * day) } }, { createdAt: { lt: new Date(Date.now() - 60 * day) } }] } }).catch(() => {});
  res.json(await prisma.notification.findMany({ where: { userId: req.currentUser.id }, orderBy: { createdAt: 'desc' }, take: 50 }));
});
router.patch('/notifications/:id/read', async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!n || n.userId !== req.currentUser.id) return res.status(404).json({ error: 'Notification not found' });
  res.json(await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } }));
});
router.delete('/notifications/read', async (req, res) => {
  const r = await prisma.notification.deleteMany({ where: { userId: req.currentUser.id, readAt: { not: null } } });
  res.json({ deleted: r.count });
});
router.post('/notifications/read-all', async (req, res) => {
  const r = await prisma.notification.updateMany({ where: { userId: req.currentUser.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: r.count });
});
export default router;
