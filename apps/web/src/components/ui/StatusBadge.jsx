import { pretty } from "../../lib/formatters";
import { STATUS_LABEL, PROGRESS_LABEL } from "../../lib/ticketStatus";
import "../../styles/status.css";
export function StatusBadge({ value }) { return <span className={"status s-" + (value || "").toLowerCase().replaceAll("_", "-")}>● {pretty(value)}</span>; }
// A ticket's status together with its progress, e.g. "Open · QA".
export function TicketStatusBadge({ ticket }) {
  return <span className={"status s-" + (ticket.status || "").toLowerCase().replaceAll("_", "-")}>● {STATUS_LABEL[ticket.status] || pretty(ticket.status)}{ticket.progress && <span className="prog"> · {PROGRESS_LABEL[ticket.progress]}</span>}</span>;
}
export function PriorityBadge({ value }) { return <span className={"priority p-" + (value || "medium").toLowerCase()}>{pretty(value || "MEDIUM")}</span>; }
