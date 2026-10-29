import { Router } from 'express';
import { verifySignature, processWebhook } from '../services/whatsapp/inbound.js';

/** Public endpoint Meta calls. Trust comes from the HMAC signature, never from cookies. Mounted at /webhooks/whatsapp. */
const router = Router();

router.get('/', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN;
  return ok ? res.status(200).send(String(req.query['hub.challenge'])) : res.sendStatus(403);
});

router.post('/', async (req, res) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const unsignedOk = process.env.WHATSAPP_ALLOW_UNSIGNED === 'true' && process.env.NODE_ENV !== 'production';
  if (!unsignedOk && !verifySignature(req.rawBody, req.headers['x-hub-signature-256'], secret)) return res.sendStatus(401);
  if (process.env.WHATSAPP_PROCESS_INLINE === 'true') { // serverless: finish the work before the function freezes
    await processWebhook(req.body).catch((e) => console.error('[wa] webhook:', e.message));
    return res.sendStatus(200);
  }
  res.sendStatus(200); // Meta needs a fast 200; the work continues in the background
  processWebhook(req.body).catch((e) => console.error('[wa] webhook:', e.message));
});
export default router;
