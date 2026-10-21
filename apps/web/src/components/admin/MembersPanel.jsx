import { useCallback, useEffect, useState } from "react";
import { UserPlus, Send, RefreshCw, Ban, Users, X } from "lucide-react";
import Panel from "../ui/Panel";
import Avatar from "../ui/Avatar";
import { api } from "../../api";
import { can, ROLE_LABELS, STAFF_ROLES, CLIENT_ROLES } from "../../lib/rbac";
import { formatDate } from "../../lib/formatters";

const TABS = [["internal", "Internal team"], ["client", "Clients"], ["invites", "Pending invitations"]];

function TeamChecks({ teams, value, onChange }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  if (!teams.length) return <small className="muted">No teams yet. Create them on the Teams page.</small>;
  return <div className="check-grid">{teams.map((t) => <label key={t.id} className="check"><input type="checkbox" checked={value.includes(t.id)} onChange={() => toggle(t.id)} />{t.name}</label>)}</div>;
}

function TeamsModal({ member, teams, onClose, onSaved, notify }) {
  const [ids, setIds] = useState(member.teams.map((t) => t.id));
  const save = () => api.put(`/admin/members/${member.id}/teams`, { teamIds: ids }).then(() => { notify("Teams updated"); onSaved(); onClose(); }).catch((e) => notify(e.response?.data?.error || "Could not update teams", "error"));
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head"><span><small>TEAMS</small><h2>{member.user.name || member.user.email}</h2></span><button type="button" onClick={onClose}><X /></button></div>
        <div className="modal-body"><p className="hint">A person can belong to several teams.</p><TeamChecks teams={teams} value={ids} onChange={setIds} /></div>
        <div className="modal-foot"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save teams</button></div>
      </div>
    </div>
  );
}

export default function MembersPanel({ me, orgs, teams = [], notify, presetOrgId = "" }) {
  const [tab, setTab] = useState("internal");
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [mode, setMode] = useState("invite"); // invite = email invitation, direct = manual provisioning
  const [form, setForm] = useState({ email: "", name: "", organizationId: presetOrgId, role: "EMPLOYEE", teamIds: [], notify: true });
  const [busy, setBusy] = useState(false);
  const [editTeams, setEditTeams] = useState(null);
  const err = useCallback((e) => notify(e.response?.data?.error || "Something went wrong", "error"), [notify]);
  const load = useCallback(() => Promise.all([api.get("/admin/members"), api.get("/admin/invitations")]).then(([m, i]) => { setMembers(m.data); setInvites(i.data); }).catch(() => notify("Could not load members", "error")), [notify]);
  useEffect(() => { load(); }, [load]);

  const grantAdmin = can(me, "member.grant_admin");
  const rolesFor = (type) => (type === "INTERNAL" ? STAFF_ROLES : CLIENT_ROLES).filter((r) => r !== "PLATFORM_ADMIN" || grantAdmin);
  const orgType = (id) => orgs.find((o) => o.id === id)?.type || "INTERNAL";
  const internalTeams = teams.filter((t) => !t.organization || t.organization.type !== "CLIENT");
  const isInternalForm = orgType(form.organizationId) === "INTERNAL";

  const pickOrg = (organizationId) => { const r = rolesFor(orgType(organizationId)); setForm({ ...form, organizationId, teamIds: [], role: r[r.length - 1] }); };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const body = { email: form.email, organizationId: form.organizationId, role: form.role, teamIds: isInternalForm ? form.teamIds : [] };
      if (mode === "invite") { await api.post("/admin/invitations", body); notify("Invitation sent. Access starts when they sign in with Google."); }
      else { await api.post("/admin/members", { ...body, name: form.name, notify: form.notify }); notify("Access granted"); }
      setForm({ ...form, email: "", name: "", teamIds: [] }); load(); if (mode === "invite") setTab("invites");
    } catch (x) { err(x); } finally { setBusy(false); }
  };
  const change = (m, body) => api.patch(`/admin/members/${m.id}`, body).then(() => { notify("Access updated"); load(); }).catch(err);
  const resend = (i) => api.post(`/admin/invitations/${i.id}/resend`).then(() => { notify("Invitation re-sent"); load(); }).catch(err);
  const revoke = (i) => window.confirm(`Revoke the invitation for ${i.email}?`) && api.delete(`/admin/invitations/${i.id}`).then(() => { notify("Invitation revoked"); load(); }).catch(err);

  const rows = members.filter((m) => m.memberType === tab);
  const clientTab = tab === "client";

  return (
    <Panel title="People & access" sub="Everyone signs in with Google. Invite by email, or add someone directly. Access is decided by membership, not by email domain.">
      <form className="invite" onSubmit={submit}>
        <div className="seg" role="group" aria-label="How to add">
          <button type="button" className={mode === "invite" ? "on" : ""} onClick={() => setMode("invite")}><Send size={14} /> Email invitation</button>
          <button type="button" className={mode === "direct" ? "on" : ""} onClick={() => setMode("direct")}><UserPlus size={14} /> Add directly</button>
        </div>
        <div className="field"><label htmlFor="m-email">Google account email</label><input id="m-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="person@any-domain.com" /></div>
        {mode === "direct" && <div className="field"><label htmlFor="m-name">Name (optional)</label><input id="m-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>}
        <div className="field"><label htmlFor="m-org">Workspace</label>
          <select id="m-org" required value={form.organizationId} onChange={(e) => pickOrg(e.target.value)}><option value="">Select…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}{o.type === "INTERNAL" ? " (internal)" : " (client)"}</option>)}</select></div>
        <div className="field"><label htmlFor="m-role">Role</label>
          <select id="m-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{rolesFor(orgType(form.organizationId)).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
        {can(me, "team.manage") && form.organizationId && isInternalForm && <div className="field wide"><label>Teams (pick one or more)</label><TeamChecks teams={internalTeams} value={form.teamIds} onChange={(teamIds) => setForm({ ...form, teamIds })} /></div>}
        {mode === "direct" && <label className="check"><input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} /> Email them that they now have access</label>}
        <button className="primary" disabled={busy || !form.organizationId}>{mode === "invite" ? <><Send size={16} /> Send invitation</> : <><UserPlus size={16} /> Add person</>}</button>
      </form>

      <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}{k === "invites" && invites.length ? ` (${invites.length})` : ""}</button>)}</div>

      {tab !== "invites" ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Person</th><th>{clientTab ? "Client" : "Workspace"}</th><th>Role</th>{!clientTab && <th>Teams</th>}<th>Status</th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const self = m.userId === me.user.id;
                const lockedAdmin = m.role === "PLATFORM_ADMIN" && !grantAdmin;
                const locked = self || lockedAdmin;
                return (
                  <tr key={m.id}>
                    <td data-label="Person"><span className="cell-person"><Avatar name={m.user.name || m.user.email} /><span><b>{m.user.name || m.user.email}{self ? " (you)" : ""}</b><div>{m.user.email}</div></span></span></td>
                    <td data-label="Workspace">{m.organization.name}</td>
                    <td data-label="Role">
                      <select className="table-select" value={m.role} disabled={locked} title={self ? "You can't change your own access" : lockedAdmin ? "Only a Platform admin can change a Platform admin" : undefined} onChange={(e) => change(m, { role: e.target.value })} aria-label={`Role for ${m.user.email}`}>
                        {[...new Set([m.role, ...rolesFor(m.organization.type)])].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    {!clientTab && <td data-label="Teams"><span className="chips">{m.teams.map((t) => <i className="chip-link" key={t.id}>{t.name}</i>)}{!m.teams.length && <small className="muted">None</small>}</span>{can(me, "team.manage") && <button className="icon-btn" title="Edit teams" aria-label={`Edit teams for ${m.user.email}`} onClick={() => setEditTeams(m)}><Users size={14} /></button>}</td>}
                    <td data-label="Status"><button className={m.isActive ? "secondary" : "primary"} disabled={locked} style={{ minHeight: 38 }} onClick={() => change(m, { isActive: !m.isActive })}>{m.isActive ? "Deactivate" : "Reactivate"}</button></td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={5}><small className="muted">No {clientTab ? "client users" : "internal members"} yet.</small></td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Email</th><th>Workspace</th><th>Role</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td data-label="Email"><b>{i.email}</b><div>by {i.invitedBy?.name || i.invitedBy?.email || "—"}</div></td>
                  <td data-label="Workspace">{i.organization.name}</td>
                  <td data-label="Role">{ROLE_LABELS[i.role]}</td>
                  <td data-label="Expires" className={i.expired ? "overdue" : ""}>{i.expired ? "Expired " : ""}{formatDate(i.expiresAt)}</td>
                  <td><span className="row-actions"><button className="secondary" onClick={() => resend(i)}><RefreshCw size={14} /> {i.expired ? "Renew" : "Resend"}</button><button className="secondary" onClick={() => revoke(i)}><Ban size={14} /> Revoke</button></span></td>
                </tr>
              ))}
              {!invites.length && <tr><td colSpan={5}><small className="muted">No pending invitations.</small></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {editTeams && <TeamsModal member={editTeams} teams={internalTeams} onClose={() => setEditTeams(null)} onSaved={load} notify={notify} />}
    </Panel>
  );
}
