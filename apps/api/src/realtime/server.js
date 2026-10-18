import { WebSocketServer } from 'ws';
import { hub } from './hub.js';
import { AppError } from '../errors/AppError.js';

const reject = (socket, code, text) => {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

/**
 * Attach a WebSocket endpoint to an http.Server.
 * authenticate(req) -> ctx | null ; handlers[type](ctx, msg, reply)
 */
export function attachRealtime(server, { authenticate, handlers, onConnect, allowedOrigins = [], path = '/ws', rateLimit = { burst: 20, everyMs: 500 } }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', async (req, socket, head) => {
    try {
      if (new URL(req.url, 'http://x').pathname !== path) return socket.destroy();
      const origin = req.headers.origin; // browsers always send it; blocks cross-site WebSocket hijacking
      if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) return reject(socket, 403, 'Forbidden');
      const ctx = await authenticate(req);
      if (!ctx) return reject(socket, 401, 'Unauthorized');
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ctx));
    } catch (e) {
      console.error('[ws] upgrade failed:', e.message);
      reject(socket, 500, 'Server Error');
    }
  });

  function onConnection(ws, ctx) {
    const userId = ctx.currentUser.id;
    const first = !hub.isOnline(userId);
    ws.isAlive = true;
    ws.isInternal = ctx.isInternal;
    hub.add(userId, ws);
    const reply = (payload) => ws.readyState === 1 && ws.send(JSON.stringify(payload));
    reply({ type: 'ready', userId, online: ctx.isInternal ? hub.onlineStaffIds() : [] });
    if (first && ctx.isInternal) hub.broadcastStaff({ type: 'presence', userId, online: true });
    if (onConnect) Promise.resolve(onConnect(ctx)).catch((e) => console.error('[ws] onConnect failed:', e.message)); // e.g. mark waiting chat messages as delivered

    let tokens = rateLimit.burst;
    const refill = setInterval(() => { tokens = Math.min(rateLimit.burst, tokens + 1); }, rateLimit.everyMs);

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return reply({ type: 'error', error: 'Invalid JSON' }); }
      const handler = handlers[msg?.type];
      if (!handler) return reply({ type: 'error', error: `Unknown message type: ${msg?.type}` });
      if (tokens <= 0) return reply({ type: msg.type === 'chat.send' ? 'chat.error' : 'error', tempId: msg.tempId, error: 'You are sending too fast' });
      tokens--;
      try {
        await handler(ctx, msg, reply);
      } catch (e) {
        if (!(e instanceof AppError)) console.error('[ws] handler error:', e);
        reply({ type: msg.type === 'chat.send' ? 'chat.error' : 'error', tempId: msg.tempId, error: e instanceof AppError ? e.message : 'Something went wrong' });
      }
    });
    ws.on('close', () => {
      clearInterval(refill);
      hub.remove(userId, ws);
      if (ctx.isInternal && !hub.isOnline(userId)) hub.broadcastStaff({ type: 'presence', userId, online: false });
    });
    ws.on('error', () => {});
  }

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(beat));
  server.on('close', () => { clearInterval(beat); for (const ws of wss.clients) ws.terminate(); });
  return wss;
}
