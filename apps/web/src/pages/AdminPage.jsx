import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, ListTodo, AlertTriangle, ShieldAlert, BarChart3 } from "lucide-react";
import Panel from "../components/ui/Panel";
import Kpi from "../components/ui/Kpi";
import Loading from "../components/ui/Loading";
import EmptyState from "../components/ui/EmptyState";
import ActivityFeed from "../components/dashboard/ActivityFeed";
import MembersPanel from "../components/admin/MembersPanel";
import RolesMatrix from "../components/admin/RolesMatrix";
import NoAccess from "../components/ui/NoAccess";
import { api } from "../api";
import { can } from "../lib/rbac";

export default function AdminPage({ me, notify, orgs = [], teams = [], presetOrgId = "" }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState(presetOrgId ? "people" : "overview");
  const [d, setD] = useState(null);

  useEffect(() => {
    if (!can(me, "admin.view")) return;
    api.get("/admin/overview").then((r) => setD(r.data)).catch((e) => notify(e.response?.data?.error || "Could not load admin data", "error"));
  }, [me, notify]);

  if (!can(me, "admin.view")) return <NoAccess what="the admin console" />;

  const tabs = (
    <div className="page-tools">
      <div className="seg" role="tablist">
        {[["overview", "Overview"], ["people", "People & access"], ["roles", "Roles"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <button type="button" className="btn-soft" onClick={() => navigate("/admin/reports")}><BarChart3 size={16} /> Open reports</button>
    </div>
  );
  if (tab === "people") return <>{tabs}<MembersPanel me={me} orgs={orgs} teams={teams} notify={notify} presetOrgId={presetOrgId} /></>;
  if (tab === "roles") return <>{tabs}<RolesMatrix /></>;
  if (!d) return <>{tabs}<Loading /></>;

  const open = d.workload.reduce((n, w) => n + w.open, 0);
  const blocked = d.workload.reduce((n, w) => n + w.blocked, 0);
  const overdue = d.workload.reduce((n, w) => n + w.overdue, 0);

  return (
    <>
      {tabs}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi icon={Users} tone="violet" label="Staff" value={d.stats.staff} hint="Active internal members" />
        <Kpi icon={ListTodo} tone="blue" label="Open tasks" value={open} hint="Across all staff" />
        <Kpi icon={ShieldAlert} tone="amber" label="Blocked tasks" value={blocked} hint="Waiting on something" />
        <Kpi icon={AlertTriangle} tone="rose" label="Overdue tasks" value={overdue} hint="Past their due date" />
      </div>
      <div className="stack">
        <Panel title="Workload" sub="Open tasks per person">
          {d.workload.length === 0 ? <EmptyState icon={<Users />} title="No staff yet" text="Invite people from People & access." /> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Person</th><th className="num">Open</th><th className="num">Blocked</th><th className="num">Overdue</th></tr></thead>
                <tbody>
                  {d.workload.map((w) => (
                    <tr key={w.id}>
                      <td data-label="Person">{w.name || w.email}</td>
                      <td data-label="Open" className="num">{w.open}</td>
                      <td data-label="Blocked" className="num">{w.blocked}</td>
                      <td data-label="Overdue" className={"num" + (w.overdue ? " overdue" : "")}>{w.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Everything that happened" sub="Latest activity across all clients and internal work">
        <ActivityFeed items={d.recent} />
      </Panel>
    </>
  );
}
