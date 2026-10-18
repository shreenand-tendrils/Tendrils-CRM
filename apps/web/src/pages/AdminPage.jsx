import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import Panel from "../components/ui/Panel";
import MetricCard from "../components/dashboard/MetricCard";
import ActivityFeed from "../components/dashboard/ActivityFeed";
import MembersPanel from "../components/admin/MembersPanel";
import RolesMatrix from "../components/admin/RolesMatrix";
import NoAccess from "../components/ui/NoAccess";
import { api } from "../api";
import { can } from "../lib/rbac";

export default function AdminPage({ me, notify, orgs = [], teams = [], presetOrgId = "" }) {
  const [tab, setTab] = useState(presetOrgId ? "people" : "overview");
  const [d, setD] = useState(null);

  useEffect(() => {
    if (!can(me, "admin.view")) return;
    api.get("/admin/overview").then((r) => setD(r.data)).catch((e) => notify(e.response?.data?.error || "Could not load admin data", "error"));
  }, [me, notify]);

  if (!can(me, "admin.view")) return <NoAccess what="the admin console" />;

  const tabs = (
    <div className="tabs" role="tablist">
      {[["overview", "Overview"], ["people", "People & access"], ["roles", "Roles"]].map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
      ))}
    </div>
  );
  if (tab === "people") return <>{tabs}<MembersPanel me={me} orgs={orgs} teams={teams} notify={notify} presetOrgId={presetOrgId} /></>;
  if (tab === "roles") return <>{tabs}<RolesMatrix /></>;
  if (!d) return <>{tabs}<small className="muted">Loading…</small></>;

  return (
    <>
      {tabs}
      <div className="metrics three">
        <MetricCard label="Staff" value={d.stats.staff} icon={Users} foot="Active internal members" />
      </div>
      <div className="stack">
        <Panel title="Workload" sub="Open tasks per person">
          <table className="data-table">
            <thead><tr><th>Person</th><th>Open</th><th>Blocked</th><th>Overdue</th></tr></thead>
            <tbody>
              {d.workload.map((w) => (
                <tr key={w.id}>
                  <td data-label="Request">{w.name || w.email}</td>
                  <td data-label="Open">{w.open}</td>
                  <td data-label="Blocked">{w.blocked}</td>
                  <td data-label="Overdue" className={w.overdue ? "overdue" : ""}>{w.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title="Everything that happened" sub="Latest activity across all clients and internal work">
        <ActivityFeed items={d.recent} />
      </Panel>
    </>
  );
}