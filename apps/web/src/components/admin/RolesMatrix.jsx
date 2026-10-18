import { useEffect, useState } from "react";
import Panel from "../ui/Panel";
import { api } from "../../api";

export default function RolesMatrix() {
  const [rbac, setRbac] = useState(null);
  useEffect(() => { api.get("/admin/rbac").then((r) => setRbac(r.data)).catch(() => {}); }, []);
  if (!rbac) return <small className="muted">Loading…</small>;
  return (
    <Panel title="Roles & permissions" sub="The same table the API enforces. Platform admins and managers can change who holds which role.">
      <div className="role-scroll table-wrap">
        <table className="data-table role-matrix">
          <thead><tr><th>Permission</th>{rbac.roles.map((r) => <th key={r.role}>{r.label}</th>)}</tr></thead>
          <tbody>
            {rbac.permissions.map((p) => (
              <tr key={p.key}>
                <td><b>{p.label}</b><div>{p.key}</div></td>
                {rbac.roles.map((r) => <td key={r.role} className={r.permissions.includes(p.key) ? "yes" : "no"} aria-label={r.permissions.includes(p.key) ? "allowed" : "not allowed"}>{r.permissions.includes(p.key) ? "✓" : "–"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
