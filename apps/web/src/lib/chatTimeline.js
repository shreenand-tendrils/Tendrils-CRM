import { fmtDate } from "./dates.js";

// Pure helpers for the ticket discussion: turn messages + ticket activity into one timeline (day separators,
// "new messages" line, grouped bubbles). No React in here so it is easy to test.
const GROUP_MS = 5 * 60 * 1000;
const dayKey = (v) => { const d = new Date(v); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export function dayLabel(v, now = new Date()) {
  if (dayKey(v) === dayKey(now)) return "Today";
  if (dayKey(v) === dayKey(new Date(now.getTime() - 86400000))) return "Yesterday";
  return fmtDate(v);
}

// Ticket activity worth showing between messages (comments and file events already appear as messages / files).
const HIDDEN_EVENTS = new Set(["COMMENT", "ATTACHMENT", "ATTACHMENT_REMOVED"]);
export const isActivityEvent = (e) => !HIDDEN_EVENTS.has(e.type);

/** The message that starts the "New messages" line: the n-th message from somebody else, counted from the end. */
export function firstUnreadId(messages, meId, unreadCount) {
  if (!unreadCount) return null;
  const others = messages.filter((m) => m.authorId !== meId && !m.deletedAt);
  return others.length >= unreadCount ? others[others.length - unreadCount].id : others[0]?.id ?? null;
}

export function buildTimeline({ messages, events = [], showEvents = true, hasEarlier = false, unreadId = null }) {
  const first = messages[0] ? new Date(messages[0].createdAt).getTime() : Infinity;
  const evs = showEvents ? events.filter((e) => isActivityEvent(e) && (!hasEarlier || new Date(e.createdAt).getTime() >= first)) : [];
  const all = [
    ...messages.map((m) => ({ kind: "msg", at: new Date(m.createdAt).getTime(), m })),
    ...evs.map((e) => ({ kind: "event", at: new Date(e.createdAt).getTime(), e })),
  ].sort((a, b) => a.at - b.at);
  const rows = [];
  let lastDay = "", prev = null;
  for (const it of all) {
    const dk = dayKey(it.at);
    if (dk !== lastDay) { rows.push({ kind: "day", key: `day-${dk}`, label: dayLabel(it.at) }); lastDay = dk; prev = null; }
    if (it.kind === "event") { rows.push({ kind: "event", key: `ev-${it.e.id}`, e: it.e }); prev = null; continue; }
    if (it.m.id === unreadId) { rows.push({ kind: "unread", key: "unread" }); prev = null; }
    const grouped = !!prev && prev.authorId === it.m.authorId && it.at - new Date(prev.createdAt).getTime() < GROUP_MS && !it.m.replyTo && !it.m.deletedAt && !prev.deletedAt;
    rows.push({ kind: "msg", key: it.m.id, m: it.m, grouped });
    prev = it.m;
  }
  return rows;
}

/** Plain-text preview of a message for lists and reply quotes ("📎 file.pdf" when it has no text). */
export const previewOf = (m) => (m.deletedAt ? "Message deleted" : m.body || ((m.attachments || []).length ? `📎 ${m.attachments[0].originalName}${m.attachments.length > 1 ? ` +${m.attachments.length - 1}` : ""}` : ""));
