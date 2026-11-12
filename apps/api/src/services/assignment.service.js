import { prisma } from '../db.js';
import { notifyUser } from './activity.js';
import { sendAssignmentEmail, sendCollaboratorEmail } from './email.service.js';

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
  sendAssignmentEmail({ to: user.email, assigneeName: user.name, itemTitle: title, itemType: kind, href, actorName: actor.name || actor.email }).catch((e) =>
    console.error('Email send failed:', e.message)
  );
}

/** In-app notification + email for people added as collaborators on a ticket (never the person who added them). */
export async function notifyCollaborators({ userIds = [], actor, ticket, assigneeName = null, teamNames = [], collaboratorNames = [], href }) {
  const ids = [...new Set(userIds)].filter((id) => id && id !== actor.id);
  if (!ids.length) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  for (const u of users) {
    try {
      await notifyUser({
        userId: u.id, type: 'ASSIGNMENT', href,
        title: `Added as collaborator: ${ticket.key} — ${ticket.title}`,
        body: `${actor.name || actor.email} added you as a collaborator on ${ticket.key}: ${ticket.title}`,
      });
    } catch (e) { console.error('[collaborator] in-app notification failed for', u.id, e.message); }
    if (u.email) {
      sendCollaboratorEmail({ to: u.email, name: u.name, actorName: actor.name || actor.email, ticket, assigneeName, teamNames, collaboratorNames: collaboratorNames.filter((n) => n !== (u.name || u.email)), href })
        .catch((e) => console.error('Email send failed:', e.message));
    }
  }
}
