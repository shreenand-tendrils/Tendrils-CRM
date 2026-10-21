import { Building2, FolderKanban, ListTodo, Ticket, Clock3, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import MetricCard from "../components/dashboard/MetricCard";
import ActivityFeed from "../components/dashboard/ActivityFeed";
import Panel from "../components/ui/Panel";
import EmptyState from "../components/ui/EmptyState";
import { PriorityBadge, StatusBadge } from "../components/ui/StatusBadge";
import { formatDate, isOverdue } from "../lib/formatters";
import ClientOverview from "../components/dashboard/ClientOverview";

export default function OverviewPage({ data, onSelectTicket }) {
  const m = data.dashboard?.metrics || {};
  const me = data.me;
  const staff = !!me?.isInternal;
  const mine = (data.tasks || []).filter((t) => t.status !== "DONE" && ((t.assignees || []).some((a) => a.user.id === me?.user.id) || t.assigneeId === me?.user.id)).slice(0, 6);
  const recentTickets = (data.tickets || []).slice(0, 5);
  const ticketRows = data.tickets || [];
  const openCount = ticketRows.filter((t) => !["CLOSED", "RESOLVED"].includes(t.status)).length;
  const closedCount = ticketRows.filter((t) => ["CLOSED", "RESOLVED"].includes(t.status)).length;
  const monthStats = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; const rows = ticketRows.filter((t) => String(t.createdAt || "").slice(0,7) === key); return { label: d.toLocaleDateString(undefined,{month:"short"}), opened: rows.length, closed: rows.filter((t) => ["CLOSED","RESOLVED"].includes(t.status)).length }; });

  if (!staff) {
    return (
      <>
        <div className="banner"><div><span className="kicker">YOUR PROJECTS AT A GLANCE</span><h2>Here’s where your work stands.</h2><p>Raise requests, follow their progress and review finished work in one place.</p></div><div className="banner-mark">t.</div></div>
        <ClientOverview data={data} onSelectTicket={onSelectTicket} />
      </>
    );
  }

  return (
    <>
      <div className="banner">
        <div><span className="kicker">YOUR OPERATIONS AT A GLANCE</span><h2>Make room for great work.</h2><p>{staff ? "Tickets assigned to you turn into tasks automatically — everything you own is below." : "Raise requests and follow their progress in one place."}</p></div>
        <div className="banner-mark">t.</div>
      </div>

      <div className="metrics">
        <MetricCard label="Active projects" value={m.projects} icon={FolderKanban} foot="Across your workspaces" />
        <Link to="/tickets?status=OPEN" style={{ color: "inherit", textDecoration: "none" }}><MetricCard label="Open tickets" value={openCount || m.tickets || 0} icon={Ticket} tone="orange" foot="Click to view open tickets" /></Link>
        <Link to="/tickets?status=CLOSED" style={{ color: "inherit", textDecoration: "none" }}><MetricCard label="Closed tickets" value={closedCount} icon={Ticket} tone="blue" foot="Click to view resolved and closed" /></Link>
        {staff && <MetricCard label="Active tasks" value={m.tasks} icon={ListTodo} tone="blue" foot="Work in motion" />}
        {staff && <MetricCard label="Overdue tasks" value={m.overdue} icon={Clock3} tone="rose" foot="Need a follow-up" />}
      </div>

      <Panel title="Monthly ticket activity" sub="Tickets created in the last six months; closed counts reflect current status">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 12, alignItems: "end", minHeight: 125 }}>
          {monthStats.map((m) => <div key={m.label} style={{ textAlign: "center" }}><div style={{ display: "flex", justifyContent: "center", alignItems: "end", gap: 4, height: 80 }}><div title={`${m.opened} opened`} style={{ width: 14, height: `${Math.max(4, Math.min(80, m.opened * 8))}px`, background: "#C9A227", borderRadius: "4px 4px 0 0" }} /><div title={`${m.closed} closed`} style={{ width: 14, height: `${Math.max(4, Math.min(80, m.closed * 8))}px`, background: "#64748b", borderRadius: "4px 4px 0 0" }} /></div><small>{m.label}</small><small style={{ display: "block", color: "var(--muted)" }}>{m.opened}/{m.closed}</small></div>)}
        </div><small className="muted">Gold: opened · Grey: currently resolved/closed. Use Tickets date filters for custom ranges.</small>
      </Panel>

      <div className="two-col">
        {staff ? (
          <Panel title="Assigned to you" sub="Your open tasks, including those created from tickets" action={<Link className="ghost" to="/tasks">All tasks</Link>}>
            {mine.map((t) => (
              <div className="update-row" key={t.id} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <span style={{ minWidth: 0, flex: 1 }}><b>{t.title}</b><small style={{ display: "block" }} className={isOverdue(t) ? "overdue" : ""}>Due {formatDate(t.dueDate)}{t.ticket ? ` · from ${t.ticket.key}` : ""}</small></span>
                <PriorityBadge value={t.priority} /><StatusBadge value={t.status} />
              </div>
            ))}
            {!mine.length && <EmptyState icon={<ListTodo />} title="Nothing assigned to you" text="New assignments will show up here." />}
          </Panel>
        ) : (
          <Panel title="Your recent tickets" sub="The latest requests you can see" action={<Link className="ghost" to="/tickets">All tickets</Link>}>
            {recentTickets.map((t) => (
              <div className="update-row" key={t.id} onClick={() => onSelectTicket?.(t)} style={{ cursor: "pointer", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <span style={{ minWidth: 0, flex: 1 }}><b>{t.key}</b><small style={{ display: "block" }}>{t.title}</small></span><StatusBadge value={t.status} />
              </div>
            ))}
            {!recentTickets.length && <EmptyState icon={<Ticket />} title="No tickets yet" text="Create a request to get started." />}
          </Panel>
        )}
        <div className="stack">
          <Panel title="Recent activity" sub="The latest changes across your workspace"><ActivityFeed items={data.dashboard?.recent || data.activity || []} /></Panel>
          <Panel title="Quick navigation">
            <div className="quick-links">
              {[[Building2, "Client workspaces", "/clients"], [FolderKanban, "Projects", "/projects"], [Ticket, "Ticket queue", "/tickets"], ...(staff ? [[ListTodo, "Task board", "/tasks"]] : [])].map(([Icon, label, to]) => (
                <Link className="quick-link" to={to} key={to}><Icon size={20} /><span>{label}</span><ArrowUpRight size={16} /></Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
