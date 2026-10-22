import { statusKeyLabel } from "./ticketStatus.js";
import { ROLE_LABELS } from "./rbac.js";

const pretty = (v = "") => String(v).toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const day = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "none");

/** One plain-language sentence per history event (without the actor's name). */
export function describeEvent(e) {
  switch (e.type) {
    case "CREATED": return "created this ticket";
    case "STATUS": return `changed status from ${e.fromLabel || statusKeyLabel(e.fromValue)} to ${e.toLabel || statusKeyLabel(e.toValue)}`;
    case "PRIORITY": return `changed priority from ${pretty(e.fromValue)} to ${pretty(e.toValue)}`;
    case "ASSIGNEE":
      if (e.toLabel && e.fromLabel) return `changed assignee from ${e.fromLabel} to ${e.toLabel}`;
      if (e.toLabel) return `assigned the ticket to ${e.toLabel}`;
      return `unassigned ${e.fromLabel || "the previous assignee"}`;
    case "TEAM":
      if (e.toLabel && e.fromLabel) return `moved the ticket from ${e.fromLabel} to ${e.toLabel}`;
      if (e.toLabel) return `routed the ticket to ${e.toLabel}`;
      return `removed the ticket from ${e.fromLabel || "its team"}`;
    case "TEAM_ACCESS": return e.toLabel ? `shared the ticket with ${e.toLabel}` : `stopped sharing the ticket with ${e.fromLabel}`;
    case "TITLE": return `renamed the ticket from “${e.fromLabel}” to “${e.toLabel}”`;
    case "DESCRIPTION": return "edited the description";
    case "DUE_DATE": return `changed the due date from ${day(e.fromValue)} to ${day(e.toValue)}`;
    case "VISIBILITY": return `made the ticket ${e.toValue === "INTERNAL" ? "internal only" : "visible to the client"}`;
    case "PROJECT": return e.toLabel ? `linked the ticket to project ${e.toLabel}` : "unlinked the ticket from its project";
    case "TASK": return `added linked task “${e.toLabel || "task"}”`;
    case "COMMENT": return e.clientVisible ? "commented" : "added an internal note";
    case "ATTACHMENT": return `attached ${e.toLabel || "a file"}`;
    default: return pretty(e.type);
  }
}

/** "Rahul Verma (Employee)" — staff roles are shown so you can tell who did what. */
export function actorLabel(e, showRole = true) {
  const a = e.actor;
  if (!a) return "Someone";
  const name = a.name || a.email;
  return showRole && a.role ? `${name} (${ROLE_LABELS[a.role] || pretty(a.role)})` : name;
}

/** Group newest-first events by calendar day: [{ day: "Oct 20, 2026", events: [...] }] */
export function groupByDay(events = []) {
  const groups = [];
  for (const e of events) {
    const d = new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const last = groups[groups.length - 1];
    if (last?.day === d) last.events.push(e); else groups.push({ day: d, events: [e] });
  }
  return groups;
}
