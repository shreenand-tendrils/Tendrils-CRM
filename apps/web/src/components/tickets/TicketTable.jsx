import { MessageSquare, Paperclip, Ticket, ListChecks } from "lucide-react";
import { formatDate, pretty } from "../../lib/formatters";
import { PriorityBadge, StatusBadge } from "../ui/StatusBadge";
import EmptyState from "../ui/EmptyState";
import Avatar from "../ui/Avatar";
import { ticketTeamLabel } from "../../lib/teams";

export default function TicketTable({ tickets = [], onSelect, showTask }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Request</th><th>Client</th><th>Status</th><th>Priority</th>{showTask && <th>Team</th>}<th>Assignee</th><th>Created</th><th>Days open</th><th>Due</th><th>Activity</th></tr></thead>
        <tbody>
          {tickets.map((t) => {
            const task = t.tasks?.[0];
            return (
              <tr key={t.id} onClick={() => onSelect?.(t)} className="clickable" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect?.(t)}>
                <td data-label="Request">
                  <b>{t.key}</b>
                  <div>{t.title}</div>
                  {showTask && task && <span className="chip-link" style={{ marginTop: 6 }}><ListChecks size={13} /> Task · {pretty(task.status)}</span>}
                </td>
                <td data-label="Client">{t.organization?.name || "—"}</td>
                <td data-label="Status"><StatusBadge value={t.status} /></td>
                <td data-label="Priority"><PriorityBadge value={t.priority} /></td>
                {showTask && <td data-label="Team">{ticketTeamLabel(t) ? <span className="chip-link">{ticketTeamLabel(t)}</span> : <span className="muted">Not routed</span>}</td>}
                <td data-label="Assignee">{t.assignee ? <span className="cell-person"><Avatar name={t.assignee.name || t.assignee.email} />{t.assignee.name || t.assignee.email}</span> : <span className="muted">Unassigned</span>}</td>
                <td data-label="Created">{formatDate(t.createdAt)}</td>
                <td data-label="Days open">{Math.max(0, Math.floor((Date.now() - new Date(t.createdAt || Date.now()).getTime()) / 86400000))}d</td>
                <td data-label="Due">{formatDate(t.dueDate)}</td>
                <td data-label="Activity"><span className="table-count"><MessageSquare size={14} />{t._count?.comments || 0} <Paperclip size={14} />{t._count?.attachments || 0}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!tickets.length && <EmptyState icon={<Ticket />} title="No tickets found" text="Create a request to start tracking client work." />}
    </div>
  );
}
