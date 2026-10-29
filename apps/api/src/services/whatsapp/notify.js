import { prisma } from '../../db.js';
import { whatsappConfigured, sendText, sendTemplate, inFreeWindow } from './cloud.js';
import { effectiveTypes } from './link.js';

const webBase = () => (process.env.WEB_ORIGIN || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');

/**
 * Outbound: every in-app notification (assignment, mention, review requested, overdue ...) may also go to WhatsApp.
 * Hooked once, inside notifyUser(), so every existing feature gets it for free.
 * Inside the 24h window -> normal text. Outside -> the approved template (WHATSAPP_TEMPLATE_NOTIFY), else skipped.
 */
export async function deliverWhatsApp(n) {
  if (!whatsappConfigured()) return { skipped: 'not-configured' };
  const link = await prisma.whatsAppLink.findUnique({ where: { userId: n.userId } });
  if (!link || link.status !== 'ACTIVE' || !link.phone || !link.notifyEnabled) return { skipped: 'not-linked' };
  if (!effectiveTypes(link).includes(n.type)) return { skipped: 'type-off' };
  const url = n.href ? `${webBase()}${n.href}` : webBase();
  if (inFreeWindow(link)) {
    await sendText(link.phone, `*${n.title}*\n${n.body}\n${url}`, n.userId);
    return { sent: 'text' };
  }
  const tpl = process.env.WHATSAPP_TEMPLATE_NOTIFY;
  if (!tpl) return { skipped: 'window-closed-no-template' };
  await sendTemplate(link.phone, tpl, [n.title, n.body, url], n.userId);
  return { sent: 'template' };
}
