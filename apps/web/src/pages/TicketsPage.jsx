import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { STATUSES, STATUS_LABEL } from "../lib/ticketStatus";
import Panel from "../components/ui/Panel";
import TicketTable from "../components/tickets/TicketTable";
import { useAppStore } from "../store";
import { can } from "../lib/rbac";
import { pretty } from "../lib/formatters";

const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const DONE = ["CLOSED"];

export default function TicketsPage({ data, onSelect }) {
  const { search } = useAppStore();
  const me = data.me;
  const staff = !!me?.isInternal;
  const [params] = useSearchParams();
  const [view, setView] = useState(params.get("view") || (params.get("overdue") ? "overdue" : staff ? "mine" : "all")); // employees land on My tickets by default
  const mineOnly = params.get("mine") === "1"; // all | mine | unrouted | overdue
  const [status, setStatus] = useState(params.get("status") ?? "OPEN"); // Open is the default filter; cards on Overview link here
  const [priority, setPriority] = useState("");
  const [teamId, setTeamId] = useState("");
  const all = data.tickets || [];

  // Teams I belong to: a ticket routed to my team with nobody assigned yet is visible to every member of that team.
  const myTeamIds = new Set((data.teams || []).filter((tm) => (tm.members || []).some((m) => m.membership?.user?.id === me?.user?.id)).map((tm) => tm.id));
  const isTeamPool = (t) => !t.assigneeId && (t.teamAccesses || []).some((a) => myTeamIds.has(a.teamId));
  const isMineTicket = (t) => isTeamPool(t) || t.assigneeId === me?.user?.id || t.requesterId === me?.user?.id || (t.tasks || []).some((task) => task.assigneeId === me?.user?.id || (task.assignees || []).some((a) => a.userId === me?.user?.id));
  const views = [
    ["all", "All", () => true],
    ...(staff ? [["mine", "My tickets & tasks", isMineTicket]] : []),
    ...(staff && can(me, "ticket.triage") ? [["unrouted", "Unrouted", (t) => !t.teamId && !DONE.includes(t.status)]] : []),
    ["overdue", "Overdue", (t) => t.dueDate && new Date(t.dueDate) < new Date() && !DONE.includes(t.status)],
  ];

  const tickets = useMemo(() => {
    const viewFn = views.find(([id]) => id === view)?.[2] || (() => true);
    const q = (search || "").toLowerCase();
    return all.filter((t) => viewFn(t)
      && (!mineOnly || isMineTicket(t))
      && (!status || t.status === status)
      && (!priority || t.priority === priority)
      && (!teamId || t.teamId === teamId || (t.teamAccesses || []).some((a) => a.teamId === teamId))
      && (!q || `${t.key} ${t.title} ${t.organization?.name || ""}`.toLowerCase().includes(q)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, view, mineOnly, status, priority, teamId, search, me?.user?.id]);

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
          <option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className="table-select" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority">
          <option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
        </select>
        {staff && (data.teams || []).length > 0 && (
          <select className="table-select" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Filter by team">
            <option value="">Any team</option>{data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
      <TicketTable tickets={tickets} onSelect={onSelect} showTask={staff} showTeam />
    </Panel>
  );
}
