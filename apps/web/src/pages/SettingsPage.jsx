import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ShieldCheck, Database, Mail, KeyRound, User, Bell, Plug, Lock, CheckCircle2, Building2, Users, Repeat } from "lucide-react";
import Panel from "../components/ui/Panel";
import Avatar from "../components/ui/Avatar";
import { ROLE_LABELS } from "../lib/rbac";
import WhatsAppPanel from "../components/integrations/WhatsAppPanel";
import McpPanel from "../components/integrations/McpPanel";
import WhatsAppAdminPanel from "../components/integrations/WhatsAppAdminPanel";
import "../styles/settings.css";

function WorkEmail({ me }) {
  const [v, setV] = useState(me?.user?.workEmail || "");
  const [msg, setMsg] = useState({ ok: true, text: "" });
  const save = async () => {
    try { await api.patch("/me/work-email", { workEmail: v }); setMsg({ ok: true, text: "Saved. New notifications will go to this address." }); }
    catch (e) { setMsg({ ok: false, text: e.response?.data?.error || "Could not save." }); }
  };
  return (
    <Panel title="Official email" sub="Ticket, task, comment and reminder emails are sent here. Leave it empty to use your sign-in email.">
      <div className="st-field">
        <label htmlFor="st-work-email">Official email address</label>
        <div className="st-inline">
          <input id="st-work-email" type="email" value={v} placeholder={me?.user?.email || "you@company.com"} onChange={(e) => { setV(e.target.value); setMsg({ ok: true, text: "" }); }} />
          <button className="primary" onClick={save}>Save</button>
        </div>
        <small className={msg.ok ? "st-hint" : "st-hint st-err"}>{msg.text || `Sign-in email: ${me?.user?.email || ""} (invitations and access emails always go there).`}</small>
      </div>
    </Panel>
  );
}

function AccountTab({ me }) {
  const roles = (me?.roles || []).map((r) => ROLE_LABELS[r] || r);
  const switchMode = () => { localStorage.removeItem("tdl_mode"); window.location.assign("/"); };
  return (
    <>
      <Panel title="Your profile" sub="How you appear to your teammates.">
        <div className="st-grid">
          <div className="st-item"><small>Name</small><b>{me?.user?.name || "-"}</b></div>
          <div className="st-item"><small>Sign-in email</small><b>{me?.user?.email}</b></div>
          <div className="st-item"><small>Roles</small><b>{roles.join(", ") || "Member"}</b></div>
          {me?.mode && <div className="st-item"><small>Working as</small><b>{me.mode === "CLIENT" ? "Client" : "Employee"}</b></div>}
        </div>
        {me?.modes?.length > 1 && <button className="secondary st-switch" onClick={switchMode}><Repeat size={15} /> Switch to {me.mode === "CLIENT" ? "Employee" : "Client"}</button>}
      </Panel>
      <Panel title="Workspaces and teams" sub="Where you have access.">
        {(me?.memberships || []).map((m) => (
          <div className="st-row" key={m.id}>
            {m.organization?.type === "INTERNAL" ? <Users size={20} /> : <Building2 size={20} />}
            <span><b>{m.organization?.name}</b><small>{ROLE_LABELS[m.role] || m.role}{m.teams?.length ? ` - ${m.teams.join(", ")}` : ""}</small></span>
          </div>
        ))}
        {!(me?.memberships || []).length && <p className="st-hint">No active workspace.</p>}
      </Panel>
    </>
  );
}

function AccessTab({ me }) {
  const groups = useMemo(() => {
    const g = {};
    for (const p of me?.permissions || []) { const [area] = p.split("."); (g[area] ||= []).push(p.slice(area.length + 1) || p); }
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [me]);
  return (
    <Panel title="Your access" sub={`${(me?.permissions || []).length} permissions from your role. Admins can change roles in the Admin console.`}>
      <div className="st-perms">
        {groups.map(([area, list]) => (
          <details key={area} className="st-perm">
            <summary><b>{area}</b><span>{list.length}</span></summary>
            <div>{list.map((p) => <span className="chip-link" key={p}>{p.replace(/_/g, " ")}</span>)}</div>
          </details>
        ))}
      </div>
    </Panel>
  );
}

function SecurityTab() {
  return (
    <Panel title="Workspace security" sub="Security is enforced by the API, not only by the interface.">
      <div className="st-row"><ShieldCheck size={20} /><span><b>Invitation-only Google sign-in</b><small>Only invited, Google-verified emails with an active membership can sign in. Admins can revoke access any time.</small></span></div>
      <div className="st-row"><Database size={20} /><span><b>PostgreSQL data store</b><small>Prisma migrations manage the relational schema.</small></span></div>
      <div className="st-row"><Mail size={20} /><span><b>Email notifications</b><small>SMTP credentials are configured by an administrator in the API environment.</small></span></div>
      <div className="st-row"><CheckCircle2 size={20} /><span><b>Server-side permissions</b><small>Every action is checked against your role, team and workspace on the server.</small></span></div>
    </Panel>
  );
}

export default function SettingsPage({ me }) {
  const [params, setParams] = useSearchParams();
  const isAdmin = (me?.permissions || []).includes("admin.view");
  const tabs = [
    { id: "account", label: "Account", icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "access", label: "Access", icon: KeyRound },
    { id: "integrations", label: "Integrations", icon: Plug },
    { id: "security", label: "Security", icon: Lock },
  ];
  const tab = tabs.some((t) => t.id === params.get("tab")) ? params.get("tab") : "account";
  const roles = (me?.roles || []).map((r) => ROLE_LABELS[r] || r);
  return (
    <div className="st-wrap">
      <header className="st-hero">
        <Avatar name={me?.user?.name || me?.user?.email} />
        <span><b>{me?.user?.name || "Tendrils member"}</b><small>{me?.user?.email}</small></span>
        <div className="st-pills">{roles.map((r) => <em key={r} className="role-pill">{r}</em>)}</div>
      </header>
      <div className="st-body">
        <nav className="st-nav" aria-label="Settings sections">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={tab === id ? "on" : ""} onClick={() => setParams({ tab: id }, { replace: true })}><Icon size={17} /> <span>{label}</span></button>
          ))}
        </nav>
        <section className="st-main">
          {tab === "account" && <AccountTab me={me} />}
          {tab === "notifications" && (<><WorkEmail me={me} /><WhatsAppPanel /></>)}
          {tab === "access" && <AccessTab me={me} />}
          {tab === "integrations" && (<><McpPanel />{isAdmin && <WhatsAppAdminPanel can={(p) => (me?.permissions || []).includes(p)} />}</>)}
          {tab === "security" && <SecurityTab />}
        </section>
      </div>
    </div>
  );
}
