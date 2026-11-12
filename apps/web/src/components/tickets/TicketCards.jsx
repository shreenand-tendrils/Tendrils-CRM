import { MessageSquare, Paperclip, Ticket } from "lucide-react";
import { PriorityBadge, TicketStatusBadge } from "../ui/StatusBadge";
import { ticketTeamLabel } from "../../lib/teams";
import { daysPassed, dayLabel } from "../../lib/ticketStatus";
import EmptyState from "../ui/EmptyState";
import Avatar from "../ui/Avatar";
import Linkify from "../ui/Linkify";
import { DueCell } from "./TicketTable";
import CopyLinkButton from "./CopyLinkButton";
import CollaboratorBadge from "./CollaboratorBadge";
import "../../styles/tickets-list.css";

/** Card layout for the Tickets page: easier to scan than a wide table. */
export default function TicketCards({ tickets = [], onSelect, showTeam }) {
  if (!tickets.length) return <EmptyState icon={<Ticket />} title="No tickets found" text="Create a request to start tracking client work." />;
  return (
    <div className="tc-grid">
      {tickets.map((t) => (
        <article key={t.id} className={`tc prio-${t.priority || "MEDIUM"}`} tabIndex={0} onClick={() => onSelect?.(t)} onKeyDown={(e) => e.key === "Enter" && onSelect?.(t)}>
          <header><b className="key-chip">{t.key}</b><CopyLinkButton ticket={t} /><PriorityBadge value={t.priority} /><span className="tc-days" title="Days since opened">{dayLabel(daysPassed(t))}</span></header>
          <h3><Linkify text={t.title} /></h3>
          <div className="tc-meta"><TicketStatusBadge ticket={t} />{t.organization?.name && <span className="chip-link">{t.organization.name}</span>}{showTeam && (ticketTeamLabel(t) ? <span className="chip-link">{ticketTeamLabel(t)}</span> : <span className="muted">Not routed</span>)}</div>
          <footer>
            <span className="cell-person">{t.assignee ? <><Avatar name={t.assignee.name || t.assignee.email} />{t.assignee.name || t.assignee.email}</> : <span className="muted">Unassigned</span>}<CollaboratorBadge ticket={t} /></span>
            <DueCell ticket={t} />
            <span className="table-count"><MessageSquare size={14} />{t._count?.comments || 0} <Paperclip size={14} />{t._count?.attachments || 0}</span>
          </footer>
          {t.requester && <small className="tc-by">Created by {t.requester.name || t.requester.email}</small>}
        </article>
      ))}
    </div>
  );
}
