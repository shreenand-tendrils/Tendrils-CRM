import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticateBearer, bearerOf, hashToken } from '../services/pat.js';
import { buildMcpServer } from '../mcp/server.js';
import { env } from '../config/env.js';

/**
 * Remote MCP endpoint (Streamable HTTP, stateless):  POST /mcp   Authorization: Bearer tdl_...
 * Auth is a personal access token ONLY (never the browser cookie), so a web page cannot drive it.
 */
const router = Router();
const limiter = rateLimit({
  windowMs: 60000, limit: 120,
  keyGenerator: (req) => (bearerOf(req.headers.authorization) ? hashToken(bearerOf(req.headers.authorization)).slice(0, 16) : req.ip),
  validate: { keyGeneratorIpFallback: false },
});
const rpcError = (res, status, message, code = -32000) => res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

router.post('/', limiter, async (req, res) => {
  const origin = req.headers.origin; // MCP spec: validate Origin to stop DNS-rebinding style calls from web pages
  if (origin && !env.webOrigins.includes(origin)) return rpcError(res, 403, 'Origin not allowed');
  const auth = await authenticateBearer(req.headers.authorization).catch(() => null);
  if (!auth) {
    res.set('WWW-Authenticate', 'Bearer realm="tendrils-mcp"');
    return rpcError(res, 401, 'Unauthorized: send "Authorization: Bearer <personal access token>" (create one in Tendrils → Settings).');
  }
  const server = buildMcpServer({ userId: auth.userId, readOnly: auth.readOnly });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[mcp]', e.message);
    if (!res.headersSent) rpcError(res, 500, 'Internal error', -32603);
  }
});
const notAllowed = (_req, res) => { res.set('Allow', 'POST'); rpcError(res, 405, 'Method not allowed: this MCP server is stateless, use POST.'); };
router.get('/', notAllowed);
router.delete('/', notAllowed);
export default router;
