// In-memory registry of live sockets per user (single API instance).
// For multiple instances, back this with Redis pub/sub.
const sockets = new Map(); // userId -> Set<WebSocket>
const OPEN = 1;

const push = (ws, data) => ws.readyState === OPEN && ws.send(data);

export const hub = {
  add(userId, ws) {
    if (!sockets.has(userId)) sockets.set(userId, new Set());
    sockets.get(userId).add(ws);
  },
  remove(userId, ws) {
    const set = sockets.get(userId);
    set?.delete(ws);
    if (set && !set.size) sockets.delete(userId);
  },
  isOnline: (userId) => sockets.has(userId),
  sendToUser(userId, payload) {
    const data = JSON.stringify(payload);
    for (const ws of sockets.get(userId) || []) push(ws, data);
  },
  sendToUsers(userIds, payload) {
    const data = JSON.stringify(payload);
    for (const id of new Set(userIds)) for (const ws of sockets.get(id) || []) push(ws, data);
  },
  broadcastStaff(payload) {
    const data = JSON.stringify(payload);
    for (const set of sockets.values()) for (const ws of set) if (ws.isInternal) push(ws, data);
  },
  onlineStaffIds() {
    return [...sockets.entries()].filter(([, set]) => [...set].some((ws) => ws.isInternal)).map(([id]) => id);
  },
};
