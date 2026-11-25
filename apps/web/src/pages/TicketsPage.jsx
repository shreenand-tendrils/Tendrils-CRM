import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Rows3, SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { STATUSES, STATUS_LABEL } from "../lib/ticketStatus";
import Panel from "../components/ui/Panel";
import TicketTable from "../components/tickets/TicketTable";
import TicketCards from "../components/tickets/TicketCards";
import "../styles/tickets-list.css";
import { useAppStore } from "../store";
import { can } from "../lib/rbac";
import { pretty } from "../lib/formatters";
import { useMediaQuery } from "../lib/useMediaQuery";

const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const DONE = ["CLOSED"];

export default function TicketsPage({ data, onSelect }) {
  const { search } = useAppStore();
  const me = data.me;
  const staff = !!me?.isInternal;
  const [params] = useSearchParams();
  const initView = params.get("view");
  const REL_KEYS = ["created", "assigned", "collab", "forteam"]; // old "view" links for these now set the Relation dropdown
  const [view, setView] = useState(["all", "mine", "unrouted"].includes(initView) ? initView : (staff && !REL_KEYS.includes(initView) && initView !== "overdue" ? "mine" : "all")); // employees land on My tickets by default
  const [rel, setRel] = useState(REL_KEYS.includes(initView) ? initView : ""); // created | assigned | collab | forteam
  const [clientId, setClientId] = useState("");
  const mineOnly = params.get("mine") === "1"; // all | mine | unrouted | overdue
  const [status, setStatus] = useState(params.get("status") ?? "OPEN"); // Open is the default filter; cards on Overview link here
  const [priority, setPriority] = useState("");
  const [teamId, setTeamId] = useState("");
  const all = data.tickets || [];
  const [sort, setSort] = useState("newest"); // newest raised first by default (by created date, not last update)
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem("tdl_ticket_layout") || "table"; } catch { return "table"; } });
  const [quick, setQuick] = useState(params.get("overdue") || initView === "overdue" ? "overdue" : ""); // overdue | unassigned (from the summary cards)
  const [limit, setLimit] = useState(25);
  const [filtersOpen, setFiltersOpen] = useState(false); // phones: status / priority / team live behind one Filters button
  const phone = useMediaQuery("(max-width: 720px)"); // phones always get the card layout (a wide table becomes a very tall stack)
  const activeFilters = [status, priority, teamId, quick, rel, clientId].filter(Boolean).length;
  const clearFilters = () => { setStatus(""); setPriority(""); setTeamId(""); setQuick(""); setRel(""); setClientId(""); setLimit(25); };
  useEffect(() => { try { localStorage.setItem("tdl_ticket_layout", layout); } catch { /* ignore */ } }, [layout]);

  // Teams I belong to: a ticket routed to my team with nobody assigned yet is visible to every member of that team.
  const myTeamIds = new Set((data.teams || []).filter((tm) => (tm.members || []).some((m) => m.membership?.user?.id === me?.user?.id)).map((tm) => tm.id));
  const isTeamPool = (t) => !t.assigneeId && (t.teamAccesses || []).some((a) => myTeamIds.has(a.teamId));
  const isCollaborating = (t) => (t.collaborators || []).some((c) => c.userId === me?.user?.id);
  const isMineTicket = (t) => isTeamPool(t) || t.assigneeId === me?.user?.id || isCollaborating(t) || t.requesterId === me?.user?.id || (t.tasks || []).some((task) => task.assigneeId === me?.user?.id || (task.assignees || []).some((a) => a.userId === me?.user?.id));
  const relations = staff ? [
    ["created", "Created by me", (t) => t.requesterId === me?.user?.id],
    ["assigned", "Assigned to me", (t) => t.assigneeId === me?.user?.id],
    ["collab", "Collaborating", isCollaborating],
    ["forteam", "For my team", (t) => myTeamIds.has(t.teamId) || (t.teamAccesses || []).some((a) => myTeamIds.has(a.teamId))],
  ] : [];
  const views = [
    ["all", "All", () => true],
    ...(staff ? [["mine", "My tickets & tasks", isMineTicket]] : []),
    ...(staff && can(me, "ticket.triage") ? [["unrouted", "Unrouted", (t) => !t.teamId && !DONE.includes(t.status)]] : []),
  ];
  const relFn = relations.find(([id]) => id === rel)?.[2] || (() => true);
  const clients = [...new Map(all.filter((t) => t.organizationId || t.organization?.id).map((t) => [t.organizationId || t.organization?.id, t.organization?.name || "Client"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const clientCount = (id) => all.filter((t) => (t.organizationId || t.organization?.id) === id).length;

  const tickets = useMemo(() => {
    const viewFn = views.find(([id]) => id === view)?.[2] || (() => true);
    const q = (search || "").toLowerCase();
    return all.filter((t) => viewFn(t) && relFn(t)
      && (!clientId || (t.organizationId || t.organization?.id) === clientId)
      && (!mineOnly || isMineTicket(t))
      && (!status || t.status === status)
      && (!priority || t.priority === priority)
      && (!teamId || t.teamId === teamId || (t.teamAccesses || []).some((a) => a.teamId === teamId))
      && (!quick || (quick === "overdue" ? t.dueDate && new Date(t.dueDate) < new Date() && !DONE.includes(t.status) : !t.assigneeId && !DONE.includes(t.status)))
      && (!q || `${t.key} ${t.title} ${t.organization?.name || ""}`.toLowerCase().includes(q)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, view, rel, clientId, mineOnly, status, priority, teamId, quick, search, me?.user?.id]);

  const rank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = useMemo(() => {
    const list = [...tickets];
    const byCreated = (a, b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b.key).localeCompare(String(a.key), undefined, { numeric: true });
    const by = {
      newest: byCreated,
      oldest: (a, b) => -byCreated(a, b),
      updated: (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt),
      due: (a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity),
      priority: (a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9),
    }[sort];
    return by ? list.sort(by) : list;
  }, [tickets, sort]);
  const shownTickets = sorted.slice(0, limit);

  // Summary cards: what needs attention inside the current view (clicking one narrows the list).
  const base = all.filter((t) => (views.find(([id]) => id === view)?.[2] || (() => true))(t) && relFn(t) && (!clientId || (t.organizationId || t.organization?.id) === clientId));
  const isOverdue = (t) => t.dueDate && new Date(t.dueDate) < new Date() && !DONE.includes(t.status);
  const stats = [
    ["Open", base.filter((t) => t.status === "OPEN").length, () => { setStatus("OPEN"); setQuick(""); }, status === "OPEN" && !quick],
    ["Waiting for review", base.filter((t) => t.status === "REVIEW_TEST").length, () => { setStatus("REVIEW_TEST"); setQuick(""); }, status === "REVIEW_TEST" && !quick],
    ["Needs info", base.filter((t) => t.status === "REVIEW_HELP").length, () => { setStatus("REVIEW_HELP"); setQuick(""); }, status === "REVIEW_HELP" && !quick],
    ["Overdue", base.filter(isOverdue).length, () => { setStatus(""); setQuick(quick === "overdue" ? "" : "overdue"); }, quick === "overdue", "danger"],
    ...(staff ? [["Unassigned", base.filter((t) => !t.assigneeId && !DONE.includes(t.status)).length, () => { setStatus(""); setQuick(quick === "unassigned" ? "" : "unassigned"); }, quick === "unassigned", "warn"]] : []),
  ];

  const count = (id) => all.filter(views.find(([v]) => v === id)[2]).length;

  return (
    <Panel title="All tickets" sub={`${tickets.length} of ${all.length} requests · Search from the workspace bar`}>
      <div className="tl-stats">
        {stats.map(([label, n, onClick, on, tone]) => (
          <button type="button" key={label} className={`tl-stat${on ? " on" : ""}${tone && n ? ` ${tone}` : ""}`} onClick={onClick}><b>{n}</b><span>{label}</span></button>
        ))}
      </div>
      <div className="tl-views" role="group" aria-label="Ticket views">
        {views.map(([id, label]) => (
          <button type="button" key={id} className={`tl-pill${view === id ? " on" : ""}`} onClick={() => { setView(id); setLimit(25); }} aria-pressed={view === id}>
            {label}{id !== "all" ? <em>{count(id)}</em> : null}
          </button>
        ))}
        {relations.length > 0 && (
          <select className={`table-select tl-rel${rel ? " on" : ""}`} value={rel} onChange={(e) => { setRel(e.target.value); setLimit(25); }} aria-label="Filter by my involvement">
            <option value="">My involvement</option>
            {relations.map(([id, label, fn]) => <option key={id} value={id}>{label} ({all.filter(fn).length})</option>)}
          </select>
        )}
        {staff && clients.length > 0 && (
          <select className={`table-select tl-rel${clientId ? " on" : ""}`} value={clientId} onChange={(e) => { setClientId(e.target.value); setLimit(25); }} aria-label="Filter by client">
            <option value="">Any client</option>
            {clients.map(([id, name]) => <option key={id} value={id}>{name} ({clientCount(id)})</option>)}
          </select>
        )}
      </div>
      <div id="tl-filters" className={`tl-filters${filtersOpen ? " open" : ""}`}>
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
        {activeFilters > 0 && <button type="button" className="tl-clear" onClick={clearFilters}><X size={14} /> Clear filters</button>}
      </div>
      <div className="tl-bar">
        <span className="tl-count">{shownTickets.length} of {tickets.length} shown</span>
        <span className="tl-bar-right">
          <button type="button" className={`tl-filter-btn${filtersOpen ? " on" : ""}`} aria-expanded={filtersOpen} aria-controls="tl-filters" onClick={() => setFiltersOpen((o) => !o)}>
            <SlidersHorizontal size={16} /> Filters{activeFilters > 0 ? <em>{activeFilters}</em> : null}
          </button>
          <select className="table-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort tickets">
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="updated">Recently updated</option><option value="due">Due soonest</option><option value="priority">Highest priority</option>
          </select>
          <span className="tl-toggle" role="group" aria-label="Layout">
            <button type="button" className={layout === "table" ? "on" : ""} aria-label="Table view" title="Table view" onClick={() => setLayout("table")}><Rows3 size={16} /></button>
            <button type="button" className={layout === "cards" ? "on" : ""} aria-label="Card view" title="Card view" onClick={() => setLayout("cards")}><LayoutGrid size={16} /></button>
          </span>
        </span>
      </div>
      {layout === "cards" || phone ? <TicketCards tickets={shownTickets} onSelect={onSelect} showTeam={staff} /> : <TicketTable tickets={shownTickets} onSelect={onSelect} showTask={staff} showTeam />}
      {tickets.length > limit && <div className="tl-more"><button type="button" className="secondary" onClick={() => setLimit(limit + 25)}>Show {Math.min(25, tickets.length - limit)} more</button></div>}
    </Panel>
  );
}
