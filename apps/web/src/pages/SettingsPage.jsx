import { useState } from "react";
import { api } from "../api";
import { ShieldCheck, Database, Mail, KeyRound } from "lucide-react";
import Panel from "../components/ui/Panel";
import { ROLE_LABELS } from "../lib/rbac";
import WhatsAppPanel from "../components/integrations/WhatsAppPanel";
import McpPanel from "../components/integrations/McpPanel";
import WhatsAppAdminPanel from "../components/integrations/WhatsAppAdminPanel";

function WorkEmail({ me }) {
  const [v, setV] = useState(me?.user?.workEmail || "");
  const [msg, setMsg] = useState("");
  const save = async () => {
    try { await api.patch("/me/work-email", { workEmail: v }); setMsg("Saved."); }
    catch (e) { setMsg(e.response?.data?.error || "Could not save."); }
  };
  return (
    <Panel title="Official email" sub={`Sign-in email: ${me?.user?.email || ""}. Notifications are sent to your official email when set.`}>
      <div className="setting-row"><Mail /><span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="email" value={v} placeholder="you@company.com" onChange={(e) => { setV(e.target.value); setMsg(""); }} style={{ minWidth: 240 }} />
        <button className="btn" onClick={save}>Save</button><small>{msg}</small>
      </span></div>
    </Panel>
  );
}

export default function SettingsPage({ me }) {
  return (
    <div className="settings-stack">
      <Panel title="Your access" sub="What your role allows. Admins can change roles in the Admin console.">
        <div className="setting-row"><KeyRound /><span><b>{(me?.roles || []).map((r) => ROLE_LABELS[r]).join(", ") || "Member"}</b><small>{(me?.permissions || []).length} permissions</small></span></div>
        <div className="people-picker" style={{ marginTop: 12 }}>{(me?.permissions || []).map((p) => <span className="chip-link" key={p}>{p}</span>)}</div>
      </Panel>
      <WorkEmail me={me} />
      <WhatsAppPanel />
      <McpPanel />
      {(me?.permissions || []).includes("admin.view") && <WhatsAppAdminPanel can={(p) => (me?.permissions || []).includes(p)} />}
      <Panel title="Workspace security" sub="Security is enforced by the API, not only by the interface.">
        <div className="setting-row"><ShieldCheck /><span><b>Invitation-only Google sign-in</b><small>Only invited, Google-verified emails with an active membership can sign in. Admins can revoke access any time.</small></span></div>
        <div className="setting-row"><Database /><span><b>PostgreSQL data store</b><small>Prisma migrations manage the relational schema.</small></span></div>
        <div className="setting-row"><Mail /><span><b>Email notifications</b><small>SMTP credentials are configured by an administrator in the API environment.</small></span></div>
      </Panel>
    </div>
  );
}
