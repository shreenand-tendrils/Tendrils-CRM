// Single shared WebSocket to /ws with auto-reconnect, plus a tiny event bus.
// Server events are re-emitted by their `type` (e.g. "chat.message", "notification").
const listeners = new Map();
let ws = null;
let retry = 0;
let timer = null;
let wanted = false;
let online = new Set();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}
export function emit(type, payload) {
  for (const fn of listeners.get(type) || []) {
    try { fn(payload); } catch (e) { console.error(`[realtime] listener for ${type} failed`, e); }
  }
}

export const isOpen = () => ws?.readyState === WebSocket.OPEN;
export const getOnline = () => online;

export function connect() {
  wanted = true;
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  clearTimeout(timer);
 
 
  const apiUrl = (
  import.meta.env.VITE_API_URL || "http://localhost:4000"
).replace(/\/+$/, "");

const wsUrl = apiUrl.replace(/^http/, "ws");

ws = new WebSocket(`${wsUrl}/ws`);
  ws.onopen = () => { retry = 0; emit("open"); };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "ready") { online = new Set(m.online || []); emit("presence", online); }
    if (m.type === "presence") {
      m.online ? online.add(m.userId) : online.delete(m.userId);
      online = new Set(online);
      emit("presence", online);
    }
    if (m.type !== "presence") emit(m.type, m); // presence listeners get the Set (emitted above), not the raw message
  };
  ws.onclose = () => {
    emit("close");
    if (wanted) timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000)); // 1s, 2s, 4s … 15s
  };
  ws.onerror = () => ws?.close();
}

export function disconnect() {
  wanted = false;
  clearTimeout(timer);
  ws?.close();
  ws = null;
  online = new Set();
}

export function send(msg) {
  if (!isOpen()) return false;
  ws.send(JSON.stringify(msg));
  return true;
}
