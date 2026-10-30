import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderKanban, Megaphone, Ticket } from "lucide-react";
import Panel from "../ui/Panel";
import EmptyState from "../ui/EmptyState";
import { StatusBadge } from "../ui/StatusBadge";
import { api } from "../../api";
import { on } from "../../lib/realtime";
import { formatDate, pretty } from "../../lib/formatters";

// What a client sees: their requests by stage, anything waiting on them, project progress and team updates.
// Internal tasks, team structure and internal comments never reach this screen (the API filters them).
export default function ClientOverview({ data, onSelectTicket }) {
  const [o, setO] = useState(null);
  const sig = (data.tickets || []).map((t) => `${t.id}:${t.status}`).join("|"); // reload when a ticket moves
  const [tick, setTick] = useState(0);
  useEffect(() => on("app.refresh", () => setTick((n) => n + 1)), []); // Refresh button + automatic refresh
  useEffect(() => { api.get("/client/overview").then((r) => setO(r.data)).catch(() => setO({ stages: {}, awaiting: [], projects: [], updates: [] })); }, [sig, tick]);
  if (!o) return <small className="muted">Loading your dashboard…</small>;
  const open = (id) => { const t = (data.tickets || []).find((x) => x.id === id); if (t) onSelectTicket?.(t); };

  return (
    <>
      {o.awaiting.length > 0 && (
        <Panel title="Waiting for your review" sub="The team finished these. Approve them or ask for changes.">
          {o.awaiting.map((t) => (
            <div className="update-row" key={t.id} onClick={() => open(t.id)} style={{ cursor: "pointer", display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
              <span><b>{t.key}</b><small style={{ display: "block" }}>{t.title}</small></span><button className="primary">Review</button>
            </div>
          ))}
        </Panel>
      )}

      <div className="two-col">
        <Panel title="Your projects" sub="Status and the latest news on each" action={<Link className="ghost" to="/projects">All projects</Link>}>
          {o.projects.map((p) => (
            <div className="update-row" key={p.id}>
              <span className="row-head"><FolderKanban size={16} /><b>{p.name}</b><StatusBadge value={p.status} /></span>
              <small className="muted">{p.organization?.name} · Due {formatDate(p.dueDate)}</small>
              <p style={{ marginTop: 4 }}>{p.latestUpdate ? `Latest: ${p.latestUpdate.title} (${formatDate(p.latestUpdate.createdAt)})` : "No updates posted yet."}</p>
            </div>
          ))}
          {!o.projects.length && <EmptyState icon={<FolderKanban />} title="No projects yet" text="Your projects appear here once the team sets them up." />}
        </Panel>
        <Panel title="Updates from the Tendrils team" sub="Progress notes on your projects" action={<Link className="ghost" to="/tickets"><Ticket size={14} /> My requests</Link>}>
          {o.updates.map((u) => (
            <div className="update-row" key={u.id}>
              <span className="row-head"><Megaphone size={16} /><b>{u.title}</b></span>
              <small className="muted">{u.project.name} · {u.author.name || u.author.email} · {formatDate(u.createdAt)}</small>
              <p style={{ marginTop: 4 }}>{u.body}</p>
            </div>
          ))}
          {!o.updates.length && <EmptyState icon={<Megaphone />} title="No updates yet" text={`When the team posts progress on a project it shows up here and you get an email. Raise a request any time with “New ticket”.`} />}
        </Panel>
      </div>
    </>
  );
}
