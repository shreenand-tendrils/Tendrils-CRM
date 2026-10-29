import { INTERNAL_HEADER, verifyInternal } from '../services/internalApi.js';

/** Marks a request as an in-process call made on behalf of a user (WhatsApp / MCP). A forged header is simply ignored. */
export function internalAuth(req, _res, next) {
  const h = req.headers[INTERNAL_HEADER];
  if (h) req.internalUserId = verifyInternal(h) || undefined;
  next();
}
