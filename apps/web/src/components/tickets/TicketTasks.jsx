import { useEffect, useState } from "react";
import { api } from "../../api";
import { StatusBadge } from "../ui/StatusBadge";
import { formatDate, pretty } from "../../lib/formatters";
import { daysPassed, dayLabel } from "../../lib/ticketStatus";
import RichText from "../ui/RichText";

// Read-only list of the work items behind a ticket (what clients see; internal comments stay internal).
export default function TicketTasks({ ticketId, refreshKey }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get(`/tickets/${ticketId}/tasks`).then((r) => setRows(r.data)).catch(() => setRows([])); }, [ticketId, refreshKey]);
  if (!rows) return <p className="hint">Loading tasks…</p>;
  if (!rows.length) return <p className="hint">No tasks yet. They appear here once the team plans the work.</p>;
  return (
    <div>
      {rows.map((t) => {
        const people = (t.assignees || []).map((a) => a.user?.name || a.user?.email).filter(Boolean);
        return (
          <div className="comment" key={t.id} style={{ marginLeft: t.parentId ? 22 : 0 }}>
            <b>{t.title}</b> <StatusBadge value={t.status} />
            {t.description && <RichText text={t.description} style={{ fontSize: 13 }} />}
            <small style={{ display: "block" }}>
              {t.team?.name ? `${t.team.name} · ` : ""}{people.length ? people.join(", ") : "Unassigned"} · {pretty(t.priority)} priority
            </small>
            <small style={{ display: "block" }}>Opened {formatDate(t.createdAt)} · Due {formatDate(t.dueDate)} · {t.completedAt ? `Done in ${dayLabel(daysPassed(t, "completedAt"))}` : `Open for ${dayLabel(daysPassed(t, "completedAt"))}`}</small>
          </div>
        );
      })}
    </div>
  );
}
