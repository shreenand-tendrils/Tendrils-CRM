import { prisma } from '../db.js';
import { notifyUser } from './activity.js';
import { sendAssignmentEmail } from './email.service.js';

/** In-app notification + best-effort email when an item is assigned. */
export async function notifyAssignment({ userId, actor, title, kind, href }) {
  if (!userId || userId === actor.id) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  await notifyUser({
    userId,
    type: 'ASSIGNMENT',
    title: `Assigned to you: ${title}`,
    body: `${actor.name || actor.email} assigned you ${kind}: ${title}`,
    href,
  });
  sendAssignmentEmail({ to: user.email, assigneeName: user.name, itemTitle: title, itemType: kind, href }).catch((e) =>
    console.error('Email send failed:', e.message)
  );
}
