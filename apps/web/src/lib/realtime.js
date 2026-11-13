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

// Production: VITE_API_URL points at the Render API (WebSocket goes direct; Vercel cannot proxy it) and a
// short-lived token replaces the cookie. Local dev: same-origin /ws through the Vite proxy with the cookie.
const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

async function wsUrl() {
  if (!API_URL) return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const r = await fetch("/api/v1/realtime/token", { credentials: "include" });
  if (!r.ok) throw new Error("no ws token");
  const { token } = await r.json();
  return `${API_URL.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`;
}

let connecting = false;
export async function connect() {
  wanted = true;
  if (connecting || (ws && ws.readyState <= WebSocket.OPEN)) return;
  clearTimeout(timer);
  connecting = true;
  let url;
  try { url = await wsUrl(); } catch { connecting = false; if (wanted) timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000)); return; }
  connecting = false;
  if (!wanted) return;
  ws = new WebSocket(url);
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
