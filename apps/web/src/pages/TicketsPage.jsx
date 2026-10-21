import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Panel from "../components/ui/Panel";
import TicketTable from "../components/tickets/TicketTable";
import { useAppStore } from "../store";
import { can } from "../lib/rbac";
import { pretty } from "../lib/formatters";

const STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "REVIEW", "CLIENT_REVIEW", "RESOLVED", "CLOSED"];
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const DONE = ["RESOLVED", "CLOSED"];
const STATUS_LABELS = { OPEN: "Open", TRIAGED: "In Progress", IN_PROGRESS: "Open - QA", BLOCKED: "Need more Info", REVIEW: "Review/Test", CLIENT_REVIEW: "Review/Help", RESOLVED: "Resolved", CLOSED: "Closed" };

export default function TicketsPage({ data, onSelect }) {
  const { search } = useAppStore();
  const [params] = useSearchParams();
  const me = data.me;
  const staff = !!me?.isInternal;
  const [view, setView] = useState("all"); // all | mine | unrouted | overdue
  const [status, setStatus] = useState(params.get("status") || "OPEN");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [priority, setPriority] = useState("");
  const [teamId, setTeamId] = useState("");
  const all = data.tickets || [];

  const views = [
    ["all", "All", () => true],
    ...(staff ? [["mine", "My tickets", (t) => t.assigneeId === me.user.id]] : []),
    ...(staff && can(me, "ticket.triage") ? [["unrouted", "Unrouted", (t) => !t.teamId && !DONE.includes(t.status)]] : []),
    ["overdue", "Overdue", (t) => t.dueDate && new Date(t.dueDate) < new Date() && !DONE.includes(t.status)],
  ];

  const tickets = useMemo(() => {
    const viewFn = views.find(([id]) => id === view)?.[2] || (() => true);
    const q = (search || "").toLowerCase();
    return all.filter((t) => viewFn(t)
      && (!status || (status === "OPEN" ? !DONE.includes(t.status) : status === "CLOSED" ? DONE.includes(t.status) : t.status === status))
      && (!fromDate || new Date(t.createdAt) >= new Date(`${fromDate}T00:00:00`))
      && (!toDate || new Date(t.createdAt) < new Date(`${toDate}T23:59:59.999`))
      && (!priority || t.priority === priority)
      && (!teamId || t.teamId === teamId || (t.teamAccesses || []).some((a) => a.teamId === teamId))
      && (!q || `${t.key} ${t.title} ${t.organization?.name || ""}`.toLowerCase().includes(q)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, view, status, fromDate, toDate, priority, teamId, search, me?.user?.id]);

  const count = (id) => all.filter(views.find(([v]) => v === id)[2]).length;

  return (
    <Panel title="All tickets" sub={`${tickets.length} of ${all.length} requests · Search from the workspace bar`}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {views.map(([id, label]) => (
          <button key={id} className={view === id ? "primary" : "secondary"} onClick={() => setView(id)} aria-pressed={view === id}>
            {label}{id !== "all" ? ` (${count(id)})` : ""}
          </button>
        ))}
        <select className="table-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option><option value="OPEN">Open</option>{STATUSES.filter((s) => s !== "OPEN").map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
        </select>
        <label className="muted">Created from <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="Created from date" /></label>
        <label className="muted">to <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="Created to date" /></label>
        <select className="table-select" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority">
          <option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
        </select>
        {staff && (data.teams || []).length > 0 && (
          <select className="table-select" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Filter by team">
            <option value="">Any team</option>{data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
      <TicketTable tickets={tickets} onSelect={onSelect} showTask={staff} />
    </Panel>
  );
}
