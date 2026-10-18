import { useEffect, useState } from "react";
import { api } from "../../api";

// Development-only helper to test the app as different roles. The API exposes
// /dev/* only when DEV_LOGIN=true and NODE_ENV !== production, so in production
// this component renders nothing.
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
          {state.users.map((u) => <option key={u.id} value={u.email}>{u.name} · {u.type === "CLIENT" ? "Client" : u.role.replace("_", " ").toLowerCase()}</option>)}
        </select>
      </label>
    );
  }

  const staff = state.users.filter((u) => u.type === "INTERNAL");
  const clients = state.users.filter((u) => u.type === "CLIENT");
  const group = (title, list) => !!list.length && (
    <div className="dev-group"><small>{title}</small>
      {list.map((u) => <button key={u.id} onClick={() => loginAs(u.email)}><b>{u.name}</b><span>{u.type === "CLIENT" ? u.organization : u.role.replace("_", " ").toLowerCase()}</span></button>)}
    </div>
  );
  return (
    <div className="dev-login">
      <div className="dev-title">DEV LOGIN · testing only</div>
      {group("Tendrils team", staff)}
      {group("Client users", clients)}
      {!state.users.length && <small>No demo users yet — run: npm run seed:demo</small>}
    </div>
  );
}
