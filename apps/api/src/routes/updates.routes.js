import { Router } from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/index.js';
import { logActivity, notifyUser, findAdmins, getInternalOrgId } from '../services/index.js';
import { sendDailyUpdateEmail } from '../services/email.service.js';
import { AppError } from '../errors/AppError.js';
import { parseBody } from '../validators/validate.js';
import { dailyUpdateUpsert } from '../validators/schemas.js';

const router = Router();
router.use('/updates', requirePermission('update.post'));

const DAY = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
const todayUtc = () => new Date(`${ymd(new Date())}T00:00:00.000Z`);

router.get('/updates/mine', async (req, res) =>
  res.json(await prisma.dailyUpdate.findMany({ where: { userId: req.currentUser.id }, orderBy: { date: 'desc' }, take: 30 }))
);

// One update per person per day; posting again edits it.
router.post('/updates', async (req, res) => {
  const input = parseBody(dailyUpdateUpsert, req.body);
  const date = input.date ?? todayUtc();
  const diff = (date - todayUtc()) / DAY;
  if (diff > 1 || diff < -7) throw new AppError('Date must be within the last 7 days (or today)', 400);

  const where = { userId_date: { userId: req.currentUser.id, date } };
  const existing = await prisma.dailyUpdate.findUnique({ where });
  const fields = { yesterday: input.yesterday, today: input.today, blockers: input.blockers ?? null, projectId: input.projectId ?? null };
  const row = await prisma.dailyUpdate.upsert({ where, update: fields, create: { userId: req.currentUser.id, date, ...fields } });

  const who = req.currentUser.name || req.currentUser.email;
  await logActivity({
    actorId: req.currentUser.id, organizationId: getInternalOrgId(req), entityType: 'update', entityId: row.id,
    action: existing ? 'updated' : 'created', summary: `${existing ? 'edited' : 'posted'} the daily update for ${ymd(date)}`,
    metadata: { visibility: 'INTERNAL', date: ymd(date) },
  });

  // Share with admins: in-app for every post/edit, email on the first post of the day.
  const admins = (await findAdmins()).filter((a) => a.id !== req.currentUser.id);
  for (const a of admins) {
    await notifyUser({ userId: a.id, type: 'SYSTEM', title: `Daily update: ${who}`, body: input.today.slice(0, 140), href: '/admin' });
  }
  if (!existing && admins.length) {
    sendDailyUpdateEmail({ to: admins.map((a) => a.email).filter(Boolean), userName: who, date: ymd(date), ...fields, blockers: fields.blockers }).catch((e) =>
      console.error('Daily update email failed:', e.message)
    );
  }
  res.status(existing ? 200 : 201).json(row);
});
export default router;
