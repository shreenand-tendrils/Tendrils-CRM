import { Router } from 'express';
import { prisma } from '../db.js';
import { requirePermission } from '../middleware/index.js';
import { AppError } from '../errors/AppError.js';
import { newToken } from '../services/pat.js';
import { startLink, unlink, effectiveTypes, ALL_NOTIFY_TYPES, deepLink } from '../services/whatsapp/link.js';
import { whatsappConfigured, maskPhone, sendText, sendTemplate, inFreeWindow } from '../services/whatsapp/cloud.js';
import { aiConfigured } from '../services/whatsapp/agent.js';
import { logActivity } from '../services/index.js';

/** Settings-page APIs: link WhatsApp, notification preferences, personal access tokens (MCP), admin overview. */
const router = Router();
// Linking and tokens are personal credentials: only from a real browser session, never from WhatsApp/MCP themselves.
const sessionOnly = (req, _res, next) => (req.internalUserId ? next(new AppError('Not available here. Use the Tendrils web app.', 403)) : next());

// Behind the Vercel proxy only /api and /auth reach Render, so show the DIRECT Render URL (API_URL / PUBLIC_API_URL).
const apiBase = (req) => (process.env.PUBLIC_API_URL || process.env.API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const webhookUrl = (req) => `${apiBase(req)}/webhooks/whatsapp`;
const mcpUrl = (req) => `${apiBase(req)}/mcp`;

router.get('/me/whatsapp', async (req, res) => {
  const l = await prisma.whatsAppLink.findUnique({ where: { userId: req.currentUser.id } });
  res.json({
    configured: whatsappConfigured(), aiAvailable: aiConfigured(), allTypes: ALL_NOTIFY_TYPES,
    linked: l?.status === 'ACTIVE', phone: l?.status === 'ACTIVE' ? maskPhone(l.phone) : null, verifiedAt: l?.verifiedAt || null,
    notifyEnabled: l ? l.notifyEnabled : true, notifyTypes: effectiveTypes(l), aiEnabled: l ? l.aiEnabled : true,
    freeWindowOpen: inFreeWindow(l), pendingCode: l?.codeExpiresAt && l.codeExpiresAt > new Date() ? { expiresAt: l.codeExpiresAt } : null,
  });
});
router.post('/me/whatsapp/link', sessionOnly, async (req, res) => {
  if (!whatsappConfigured()) throw new AppError('WhatsApp is not configured on this server yet. Ask an administrator.', 503);
  res.status(201).json({ ...(await startLink(req.currentUser.id)), businessNumber: process.env.WHATSAPP_BUSINESS_NUMBER || null });
});
router.patch('/me/whatsapp', sessionOnly, async (req, res) => {
  const { notifyEnabled, notifyTypes, aiEnabled } = req.body || {};
  const data = {};
  if (typeof notifyEnabled === 'boolean') data.notifyEnabled = notifyEnabled;
  if (typeof aiEnabled === 'boolean') data.aiEnabled = aiEnabled;
  if (Array.isArray(notifyTypes)) data.notifyTypes = notifyTypes.filter((t) => ALL_NOTIFY_TYPES.includes(t));
  const l = await prisma.whatsAppLink.findUnique({ where: { userId: req.currentUser.id } });
  if (!l || l.status !== 'ACTIVE') throw new AppError('Link your WhatsApp first.', 400);
  await prisma.whatsAppLink.update({ where: { id: l.id }, data });
  res.json({ ok: true });
});
router.delete('/me/whatsapp', sessionOnly, async (req, res) => {
  await unlink(req.currentUser.id);
  res.json({ ok: true });
});
router.post('/me/whatsapp/test', sessionOnly, async (req, res) => {
  const l = await prisma.whatsAppLink.findUnique({ where: { userId: req.currentUser.id } });
  if (!l || l.status !== 'ACTIVE') throw new AppError('Link your WhatsApp first.', 400);
  if (inFreeWindow(l)) await sendText(l.phone, '✅ Test from Tendrils. Notifications are working. Send *help* to see commands.', l.userId);
  else if (process.env.WHATSAPP_TEMPLATE_NOTIFY) await sendTemplate(l.phone, process.env.WHATSAPP_TEMPLATE_NOTIFY, ['Test notification', 'WhatsApp is connected.', process.env.WEB_ORIGIN?.split(',')[0] || ''], l.userId);
  else throw new AppError('Send any message to the Tendrils WhatsApp number first (opens a 24-hour window), then try again.', 409);
  res.json({ ok: true });
});

// ---- personal access tokens (MCP) ----
router.get('/me/tokens', async (req, res) => {
  const rows = await prisma.apiToken.findMany({ where: { userId: req.currentUser.id, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true } });
  res.json({ tokens: rows, mcpUrl: mcpUrl(req) });
});
router.post('/me/tokens', sessionOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (name.length < 2) throw new AppError('Give the token a name (e.g. "Claude Desktop").', 400);
  const readOnly = req.body?.readOnly === true;
  const days = Math.min(Math.max(Number(req.body?.expiresInDays) || 90, 1), 365);
  if ((await prisma.apiToken.count({ where: { userId: req.currentUser.id, revokedAt: null } })) >= 10) throw new AppError('You already have 10 active tokens. Revoke one first.', 400);
  const t = newToken();
  const row = await prisma.apiToken.create({ data: { userId: req.currentUser.id, name, tokenHash: t.hash, prefix: t.prefix, scopes: readOnly ? ['read'] : [], expiresAt: new Date(Date.now() + days * 86400000) } });
  await logActivity({ actorId: req.currentUser.id, entityType: 'access', entityId: row.id, action: 'token_created', summary: `${req.currentUser.name || req.currentUser.email} created an API token "${name}"${readOnly ? ' (read-only)' : ''}` });
  res.status(201).json({ id: row.id, name, token: t.raw, expiresAt: row.expiresAt, readOnly, mcpUrl: mcpUrl(req) }); // raw token is returned ONCE
});
router.delete('/me/tokens/:id', sessionOnly, async (req, res) => {
  const r = await prisma.apiToken.updateMany({ where: { id: req.params.id, userId: req.currentUser.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw new AppError('Token not found', 404);
  res.json({ ok: true });
});

// ---- admin overview ----
router.get('/admin/whatsapp', requirePermission('admin.view'), async (req, res) => {
  const [links, recent, counts] = await Promise.all([
    prisma.whatsAppLink.findMany({ where: { status: 'ACTIVE' }, orderBy: { verifiedAt: 'desc' }, take: 200, include: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.whatsAppMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 25, select: { id: true, direction: true, kind: true, status: true, error: true, createdAt: true, userId: true } }),
    prisma.whatsAppMessage.groupBy({ by: ['direction', 'status'], where: { createdAt: { gt: new Date(Date.now() - 7 * 86400000) } }, _count: { _all: true } }),
  ]);
  res.json({
    configured: whatsappConfigured(), aiAvailable: aiConfigured(), webhookUrl: webhookUrl(req), businessNumber: process.env.WHATSAPP_BUSINESS_NUMBER || null,
    templateConfigured: Boolean(process.env.WHATSAPP_TEMPLATE_NOTIFY), signatureSecretSet: Boolean(process.env.WHATSAPP_APP_SECRET),
    links: links.map((l) => ({ userId: l.userId, name: l.user.name, email: l.user.email, phone: maskPhone(l.phone), verifiedAt: l.verifiedAt, notifyEnabled: l.notifyEnabled })),
    recent, last7days: counts.map((c) => ({ direction: c.direction, status: c.status, count: c._count._all })),
  });
});
router.delete('/admin/whatsapp/:userId', requirePermission('member.manage'), async (req, res) => {
  await unlink(req.params.userId);
  await logActivity({ actorId: req.currentUser.id, entityType: 'access', entityId: req.params.userId, action: 'whatsapp_unlinked', summary: 'WhatsApp number unlinked by an administrator' });
  res.json({ ok: true });
});
export { deepLink };
export default router;
