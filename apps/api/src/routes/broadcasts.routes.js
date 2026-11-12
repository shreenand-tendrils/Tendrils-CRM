import { Router } from 'express';
import { prisma } from '../db.js';
import { AppError } from '../errors/AppError.js';
import { notifyPeople, findTeamManagers } from '../services/notify.service.js';

const router = Router();
const sentLog = new Map(); // userId -> timestamps (simple spam guard: 20 broadcasts / hour / person)

/** Active employees / admins of the internal workspace. */
const staffWhere = { memberships: { some: { isActive: true, role: { in: ['PLATFORM_ADMIN', 'EMPLOYEE'] }, organization: { type: 'INTERNAL', isActive: true } } } };

/**
 * POST /broadcasts  { audience: 'ALL' | 'TEAMS' | 'PEOPLE', teamIds?, userIds?, title, message, urgent?, email? }
 * - ALL (everyone on the team side) needs broadcast.all (admins).
 * - TEAMS / PEOPLE (and a mix of both) need broadcast.send (employees + admins).
 * Everyone reached gets an in-app notification (and WhatsApp when linked); email too unless email=false.
 */
router.post('/broadcasts', async (req, res) => {
  if (!req.can('broadcast.send')) throw new AppError('You cannot send announcements.', 403, 'FORBIDDEN');
  const { audience, teamIds = [], userIds = [], urgent = false, email = true } = req.body || {};
  const title = String(req.body?.title || '').trim();
  const message = String(req.body?.message || '').trim();
  if (title.length < 2 || title.length > 140) throw new AppError('Give the message a short title (2-140 characters).', 400, 'VALIDATION');
  if (message.length < 2 || message.length > 2000) throw new AppError('Write a message (up to 2000 characters).', 400, 'VALIDATION');
  if (!['ALL', 'TEAMS', 'PEOPLE'].includes(audience)) throw new AppError('Choose who should receive it.', 400, 'VALIDATION');
  if (audience === 'ALL' && !req.can('broadcast.all')) throw new AppError('Only admins can message everyone. Pick teams or people instead.', 403, 'FORBIDDEN');

  const now = Date.now();
  const recent = (sentLog.get(req.currentUser.id) || []).filter((t) => now - t < 36e5);
  if (recent.length >= 20) throw new AppError('You have sent a lot of messages this hour. Please try again later.', 429, 'RATE_LIMITED');

  let ids = new Set();
  let label = 'sent to you';
  if (audience === 'ALL') {
    (await prisma.user.findMany({ where: staffWhere, select: { id: true } })).forEach((u) => ids.add(u.id));
    label = 'to everyone';
  } else {
    if (!Array.isArray(teamIds) || !Array.isArray(userIds) || teamIds.length + userIds.length === 0) throw new AppError('Pick at least one team or person.', 400, 'VALIDATION');
    const teams = teamIds.length ? await prisma.team.findMany({ where: { id: { in: teamIds }, isActive: true, organization: { type: 'INTERNAL' } }, select: { id: true, name: true } }) : [];
    if (teams.length) { (await findTeamManagers(teams.map((t) => t.id))).forEach((u) => ids.add(u.id)); label = `to ${teams.map((t) => t.name).join(', ')}`; }
    if (userIds.length) (await prisma.user.findMany({ where: { id: { in: userIds }, ...staffWhere }, select: { id: true } })).forEach((u) => ids.add(u.id));
  }
  ids.delete(req.currentUser.id);
  if (!ids.size) throw new AppError('Nobody to send this to. Check the teams or people you picked.', 400, 'NO_RECIPIENTS');

  const sender = req.currentUser.name || req.currentUser.email;
  await notifyPeople({
    userIds: [...ids], actorId: req.currentUser.id, type: 'SYSTEM', email: email !== false,
    title: `${urgent ? 'URGENT: ' : ''}${title}`,
    body: `${sender} (${label}):\n\n${message}`,
    href: '/notifications',
  });
  sentLog.set(req.currentUser.id, [...recent, now]);
  res.status(201).json({ sent: ids.size });
});

export default router;
