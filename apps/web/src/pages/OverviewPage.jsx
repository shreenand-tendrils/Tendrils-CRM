import { Building2, FolderKanban, ListTodo, Ticket, Clock3, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import MetricCard from "../components/dashboard/MetricCard";
import ActivityFeed from "../components/dashboard/ActivityFeed";
import Panel from "../components/ui/Panel";
import EmptyState from "../components/ui/EmptyState";
import { PriorityBadge, StatusBadge } from "../components/ui/StatusBadge";
import { formatDate, isOverdue } from "../lib/formatters";
import ClientOverview from "../components/dashboard/ClientOverview";
import AnalyticsPanel from "../components/dashboard/AnalyticsPanel";
import { TicketStatusBadge } from "../components/ui/StatusBadge";

export default function OverviewPage({ data, onSelectTicket }) {
  const m = data.dashboard?.metrics || {};
  const me = data.me;
  const staff = !!me?.isInternal;
  const mine = (data.tasks || []).filter((t) => t.status !== "DONE" && ((t.assignees || []).some((a) => a.user.id === me?.user.id) || t.assigneeId === me?.user.id)).slice(0, 6);
  const recentTickets = (data.tickets || []).slice(0, 5);

  if (!staff) {
    return (
      <>
        <div className="banner"><div><span className="kicker">YOUR PROJECTS AT A GLANCE</span><h2>Here’s where your work stands.</h2><p>Raise requests, follow their progress and review finished work in one place.</p></div><div className="banner-mark">t.</div></div>
        <AnalyticsPanel staff={false} />
        <ClientOverview data={data} onSelectTicket={onSelectTicket} />
      </>
    );
  }

  return (
    <>
      <div className="banner">
        <div><span className="kicker">YOUR OPERATIONS AT A GLANCE</span><h2>Make room for great work.</h2><p>Tickets, their tasks and everything you own are below.</p></div>
        <div className="banner-mark">t.</div>
      </div>

      <AnalyticsPanel staff />
      <div className="metrics">
        <MetricCard label="Active projects" value={m.projects} icon={FolderKanban} foot="Across your workspaces" />
        <MetricCard label="Open tickets" value={m.tickets} icon={Ticket} tone="orange" foot="Requests needing progress" />
        {staff && <MetricCard label="Active tasks" value={m.tasks} icon={ListTodo} tone="blue" foot="Work in motion" />}
        {staff && <MetricCard label="Overdue tasks" value={m.overdue} icon={Clock3} tone="rose" foot="Need a follow-up" />}
      </div>

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
                <span style={{ minWidth: 0, flex: 1 }}><b>{t.key}</b><small style={{ display: "block" }}>{t.title}</small></span><TicketStatusBadge ticket={t} />
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
