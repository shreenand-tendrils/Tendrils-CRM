// Ticket status + progress (Open: In Progress / QA, Review/Help: Need more Info, Review/Test: Resolved, Closed) and day counters.
export const STATUSES = ["OPEN", "REVIEW_TEST", "REVIEW_HELP", "CLOSED"];
export const STATUS_LABEL = { OPEN: "Open", REVIEW_TEST: "Review/Test", REVIEW_HELP: "Review/Help", CLOSED: "Closed" };
export const PROGRESS_LABEL = { IN_PROGRESS: "In Progress", QA: "QA", NEED_MORE_INFO: "Need more Info", RESOLVED: "Resolved" };
export const PROGRESS_FOR = { OPEN: ["IN_PROGRESS", "QA"], REVIEW_HELP: ["NEED_MORE_INFO"], REVIEW_TEST: ["RESOLVED"], CLOSED: [] };
export const statusText = (t) => `${STATUS_LABEL[t.status] || t.status}${t.progress ? ` · ${PROGRESS_LABEL[t.progress]}` : ""}`;

/** What a client reads instead of the staff wording. */
export const clientStatusText = ({ status, progress }) => {
  if (status === "OPEN") return progress === "QA" ? "Being tested" : progress === "IN_PROGRESS" ? "In progress" : "Received";
  if (status === "REVIEW_HELP") return "We need more information from you";
  if (status === "REVIEW_TEST") return "Waiting for your review";
  return "Closed";
};

const DAY = 86400000;
/** Days since the ticket/task was opened; for finished ones, days it took to close. */
export const daysPassed = (item, endField = "closedAt") => {
  const end = item[endField] ? new Date(item[endField]) : new Date();
  return Math.max(0, Math.floor((end - new Date(item.createdAt)) / DAY));
};
export const dayLabel = (n) => `${n} day${n === 1 ? "" : "s"}`;

/** Old history entries stored plain statuses; new ones store "STATUS:PROGRESS". */
export const statusKeyLabel = (key = "") => {
  const [s, p] = String(key).split(":");
  return `${STATUS_LABEL[s] || s.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}${p ? ` · ${PROGRESS_LABEL[p] || p}` : ""}`;
};
