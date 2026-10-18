import { useEffect, useState } from "react";
import { ShieldCheck, Users, CheckCircle2, AlertTriangle } from "lucide-react";
import Panel from "../components/ui/Panel";
import MetricCard from "../components/dashboard/MetricCard";
import ActivityFeed from "../components/dashboard/ActivityFeed";
import EmptyState from "../components/ui/EmptyState";
import Avatar from "../components/ui/Avatar";
import MembersPanel from "../components/admin/MembersPanel";
import RolesMatrix from "../components/admin/RolesMatrix";
import NoAccess from "../components/ui/NoAccess";
import { api } from "../api";
import { can } from "../lib/rbac";
import { pretty } from "../lib/formatters";

export default function AdminPage({ me, notify, orgs = [], teams = [], presetOrgId = "" }) {
  const [tab, setTab] = useState(presetOrgId ? "people" : "overview");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [d, setD] = useState(null);

  useEffect(() => {
    if (!can(me, "admin.view")) return;
    api.get("/admin/overview", { params: { date } }).then((r) => setD(r.data)).catch((e) => notify(e.response?.data?.error || "Could not load admin data", "error"));
  }, [date, me, notify]);

  if (!can(me, "admin.view")) return <NoAccess what="the admin console" />;

  const tabs = (
    <div className="tabs" role="tablist">
      {[["overview", "Daily overview"], ["people", "People & access"], ["roles", "Roles"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
    </div>
  );
  if (tab === "people") return <>{tabs}<MembersPanel me={me} orgs={orgs} teams={teams} notify={notify} presetOrgId={presetOrgId} /></>;
  if (tab === "roles") return <>{tabs}<RolesMatrix /></>;
  if (!d) return <>{tabs}<small className="muted">Loading…</small></>;

  return (
    <>
      {tabs}
      <div className="toolbar">
        <label className="field inline"><span>Updates for</span><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
      </div>
      <div className="metrics three">
        <MetricCard label="Staff" value={d.stats.staff} icon={Users} foot="Active internal members" />
        <MetricCard label="Updates submitted" value={d.stats.submitted} icon={CheckCircle2} tone="blue" foot={`For ${d.date}`} />
        <MetricCard label="Missing updates" value={d.stats.missing} icon={AlertTriangle} tone="rose" foot="Not yet submitted" />
      </div>

      <div className="two-col">
        <Panel title="Daily updates" sub={`Submitted on ${d.date}`}>
          {d.updates.map((u) => (
            <div className="update-row" key={u.id}>
              <span className="row-head"><Avatar name={u.user.name || u.user.email} /><b>{u.user.name || u.user.email}</b></span>
              <small className="muted">Done</small><p>{u.yesterday}</p>
              <small className="muted">Planned</small><p>{u.today}</p>
              {u.blockers && <><small className="overdue">Blockers</small><p>{u.blockers}</p></>}
            </div>
          ))}
          {!d.updates.length && <EmptyState icon={<CheckCircle2 />} title="No updates yet" text="Nothing has been submitted for this day." />}
        </Panel>
        <div className="stack">
          <Panel title="Waiting on" sub="No update for this day">
            {d.missing.map((u) => <div className="person-row" key={u.id}><Avatar name={u.name || u.email} /><span><b>{u.name || u.email}</b><small>{pretty(u.role)}</small></span></div>)}
            {!d.missing.length && <small className="muted">Everyone has submitted.</small>}
          </Panel>
          <Panel title="Workload" sub="Open tasks per person">
            <table className="data-table"><thead><tr><th>Person</th><th>Open</th><th>Blocked</th><th>Overdue</th></tr></thead><tbody>
              {d.workload.map((w) => <tr key={w.id}><td data-label="Request">{w.name || w.email}</td><td data-label="Open">{w.open}</td><td data-label="Blocked">{w.blocked}</td><td data-label="Overdue" className={w.overdue ? "overdue" : ""}>{w.overdue}</td></tr>)}
            </tbody></table>
          </Panel>
        </div>
      </div>
      <Panel title="Everything that happened" sub="Latest activity across all clients and internal work"><ActivityFeed items={d.recent} /></Panel>
    </>
  );
}
