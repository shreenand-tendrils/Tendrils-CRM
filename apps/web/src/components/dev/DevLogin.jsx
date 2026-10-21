import { useEffect, useState } from "react";
import { api } from "../../api";

// Development-only helper to test the app as different roles. The API exposes
// /dev/* only when DEV_LOGIN=true and NODE_ENV !== production, so in production
// this component renders nothing.
// "Rahul Verma — Manager · Development"  /  "Boss — Client admin (Client boss) · Sofabed"
const personLine = (u) => `${u.name} — ${u.roleLabel || u.role}${u.type === "CLIENT" ? ` · ${u.organization}` : u.teams?.length ? ` · ${u.teams.join(", ")}` : ""}`;

export default function DevLogin({ variant = "signin" }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    api.get("/dev/status")
      .then(async (s) => setState({ current: s.data.current, users: (await api.get("/dev/users")).data }))
      .catch(() => setState(null));
  }, []);
  if (!state) return null;

  const loginAs = async (email) => { await api.post("/dev/login", { email }); window.location.assign("/"); };
  const useGoogle = async () => { await api.post("/dev/logout"); window.location.assign("/"); };

  if (variant === "switcher") {
    return (
      <label className="dev-switch">
        <small>DEV · view as</small>
        <select value={state.current || ""} onChange={(e) => (e.target.value ? loginAs(e.target.value) : useGoogle())}>
          <option value="">My Google account</option>
          {state.users.map((u) => <option key={u.id} value={u.email}>{personLine(u)}</option>)}
        </select>
      </label>
    );
  }

  const by = (role) => state.users.filter((u) => u.role === role);
  const group = (title, list) => !!list.length && (
    <div className="dev-group"><small>{title}</small>
      {list.map((u) => <button key={u.id} onClick={() => loginAs(u.email)}><b>{u.name}</b><span>{u.roleLabel}{u.type === "CLIENT" ? ` · ${u.organization}` : u.teams?.length ? ` · ${u.teams.join(", ")}` : ""}</span></button>)}
    </div>
  );
  return (
    <div className="dev-login">
      <div className="dev-title">DEV LOGIN · testing only</div>
      {group("Root admin / Boss", by("PLATFORM_ADMIN"))}
      {group("Employees", [...by("MANAGER"), ...by("EMPLOYEE")])}
      {group("Employees", by("EMPLOYEE"))}
      {group("Client boss (client admin)", by("CLIENT_ADMIN"))}
      {group("Client members", by("CLIENT_MEMBER"))}
      {!state.users.length && <small>No demo users yet — run: npm run seed:demo</small>}
    </div>
  );
}
