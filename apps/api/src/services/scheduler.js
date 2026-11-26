import { prisma } from '../db.js';
import { notifyUser } from './activity.js';
import { pingReview } from './reviews.service.js';

const DAY = 86400000;
const DONE = ['REVIEW_TEST', 'CLOSED']; // resolved or closed: nothing left to be late on

/** Fire reminders whose time has come (once each). */
export async function fireDueReminders(now = new Date()) {
  const due = await prisma.reminder.findMany({
    where: { remindAt: { lte: now }, notifiedAt: null, doneAt: null },
    include: { ticket: { select: { id: true, key: true } } }, take: 200,
  });
  for (const r of due) {
    await notifyUser({ userId: r.userId, type: 'SYSTEM', title: `Reminder: ${r.title}`, body: r.ticket ? `About ${r.ticket.key}` : 'Your reminder is due.', href: r.ticket ? `/?ticket=${r.ticket.id}` : '/reminders' });
    await prisma.reminder.update({ where: { id: r.id }, data: { notifiedAt: now } });
  }
  return due.length;
}

/** Tell assignees about tickets due within 24h (DUE_SOON) or already late (OVERDUE). At most once per ticket per type per day. */
export async function alertDueTickets(now = new Date()) {
  const tickets = await prisma.ticket.findMany({
    where: { assigneeId: { not: null }, status: { notIn: DONE }, dueDate: { not: null, lte: new Date(now.getTime() + DAY) } },
    select: { id: true, key: true, title: true, assigneeId: true, dueDate: true }, take: 500,
  });
  let sent = 0;
  for (const t of tickets) {
    const type = t.dueDate < now ? 'OVERDUE' : 'DUE_SOON';
    const href = `/?ticket=${t.id}`;
    const recent = await prisma.notification.findFirst({ where: { userId: t.assigneeId, type, href, createdAt: { gt: new Date(now.getTime() - DAY) } }, select: { id: true } });
    if (recent) continue;
    await notifyUser({ userId: t.assigneeId, type, title: type === 'OVERDUE' ? `${t.key} is overdue` : `${t.key} is due soon`, body: t.title, href });
    sent += 1;
  }
  return sent;
}

/** Remind reviewers who have not decided on reviews due within 24h or already late (once per person per review per day). */
export async function alertDueReviews(now = new Date()) {
  const reviews = await prisma.productReview.findMany({
    where: { status: 'IN_REVIEW', dueDate: { not: null, lte: new Date(now.getTime() + DAY) } },
    include: { reviewers: { where: { decision: 'PENDING' } }, items: { where: {} } }, take: 300,
  });
  let sent = 0;
  for (const r of reviews) {
    const href = `/reviews?open=${r.id}`;
    const items = r.items.filter((i) => i.version === r.version);
    for (const slot of r.reviewers) {
      const recent = await prisma.notification.findFirst({ where: { userId: slot.userId, href, type: { in: ['DUE_SOON', 'OVERDUE'] }, createdAt: { gt: new Date(now.getTime() - DAY) } }, select: { id: true } });
      if (recent) continue;
      await pingReview({ userIds: [slot.userId], actorId: null, review: r, kind: 'reminder', items, title: r.dueDate < now ? `Review overdue: ${r.title}` : `Review due soon: ${r.title}`, body: 'You have not decided on this review yet.' });
      sent += 1;
    }
  }
  return sent;
}

export function startScheduler() {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_SCHEDULER === 'true') return () => {};
  const safe = (fn) => () => fn().catch((e) => console.error('[scheduler]', e.message));
  const a = setInterval(safe(fireDueReminders), 60 * 1000);
  const b = setInterval(safe(alertDueTickets), 15 * 60 * 1000);
  setTimeout(safe(alertDueTickets), 15 * 1000);
  const c = setInterval(safe(alertDueReviews), 30 * 60 * 1000);
  setTimeout(safe(alertDueReviews), 25 * 1000);
  return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
}
