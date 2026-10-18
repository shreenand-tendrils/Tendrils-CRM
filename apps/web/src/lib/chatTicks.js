// Mirror of apps/api/src/services/chatLogic.js (tickStatus, EDIT_WINDOW_MS). Keep the two in sync.
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export function tickStatus(message, receipts) {
  if (!receipts.length) return "sent";
  const at = new Date(message.createdAt).getTime();
  const ts = (v) => (v ? new Date(v).getTime() : -Infinity);
  if (receipts.every((r) => ts(r.readAt) >= at)) return "read";
  if (receipts.every((r) => Math.max(ts(r.deliveredAt), ts(r.readAt)) >= at)) return "delivered";
  return "sent";
}
export const nameOf = (u) => u?.name || u?.email?.split("@")[0] || "someone";
