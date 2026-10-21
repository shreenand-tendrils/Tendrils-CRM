import { useCallback, useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2, UserPlus, RotateCcw, X } from "lucide-react";
import EmptyState from "../components/ui/EmptyState";
import PeoplePicker from "../components/ui/PeoplePicker";
import AvatarStack from "../components/ui/AvatarStack";
import { api } from "../api";
import { can } from "../lib/rbac";

function Shell({ title, onClose, children, foot }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head"><span><h2>{title}</h2></span><button type="button" onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{foot}</div>
      </div>
    </div>
  );
}

// Everyone with team access sees the teams. Only the Platform admin (team.manage) can create, edit, archive and fill them.
export default function TeamsPage({ data, me, onRefresh, notify }) {
  const manage = can(me, "team.manage");
  const [rows, setRows] = useState(data.teams || []);
  const [editor, setEditor] = useState(null);   // { team? } create or edit
  const [rosterFor, setRosterFor] = useState(null);
  const [staff, setStaff] = useState([]);
  const load = useCallback(() => (manage ? api.get("/teams", { params: { all: 1 } }).then((r) => setRows(r.data)).catch(() => setRows(data.teams || [])) : setRows(data.teams || [])), [manage, data.teams]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (manage) api.get("/teams/candidates").then((r) => setStaff(r.data)).catch(() => setStaff([])); }, [manage]);
  const done = (msg) => { notify?.(msg); onRefresh?.(); load(); };
  const fail = (e) => notify?.(e.response?.data?.error || "Something went wrong", "error");

  const [form, setForm] = useState({ name: "", description: "", clientVisible: true });
  const [roster, setRoster] = useState([]);
  const openEditor = (team) => { setForm({ name: team?.name || "", description: team?.description || "", clientVisible: team?.clientVisible !== false }); setEditor({ team }); };
  const saveTeam = async () => {
    try {
      if (editor.team) await api.patch(`/teams/${editor.team.id}`, form); else await api.post("/teams", form);
      setEditor(null); done(editor.team ? "Team updated" : "Team created");
    } catch (e) { fail(e); }
  };
  const remove = async (t) => {
    if (!window.confirm(`Remove team “${t.name}”? If it has work history it is archived instead of deleted.`)) return;
    try { const r = await api.delete(`/teams/${t.id}`); done(r.data.archived ? "Team archived (it has work history)" : "Team deleted"); } catch (e) { fail(e); }
  };
  const restore = (t) => api.patch(`/teams/${t.id}`, { isActive: true }).then(() => done("Team restored")).catch(fail);
  const saveRoster = async () => {
    try { await api.put(`/teams/${rosterFor.id}/members`, { membershipIds: roster }); setRosterFor(null); done("Members updated"); } catch (e) { fail(e); }
  };
  const openRoster = (t) => { setRoster((t.members || []).map((m) => m.membership.id)); setRosterFor(t); };

  return (
    <>
      {manage && <div className="row" style={{ marginBottom: 14 }}><button className="primary" onClick={() => openEditor(null)}><Plus size={14} /> New team</button><small className="hint">Only the Platform admin can create teams and change who is in them.</small></div>}
      <div className="cards">
        {rows.map((t) => (
          <article className="team-card" key={t.id} style={t.isActive === false ? { opacity: 0.6 } : undefined}>
            <div className="project-icon"><Users /></div>
            <h3>{t.name}{t.isActive === false && " (archived)"}</h3>
            <p>{t.description || "A focused team collaborating on client delivery."}</p>
            <AvatarStack users={(t.members || []).map((m) => m.membership?.user).filter(Boolean)} max={5} />
            <small>{t._count?.members ?? (t.members || []).length} members{manage ? ` · ${t.clientVisible === false ? "hidden from clients" : "clients can choose it"}` : ""}</small>
            {manage && (
              <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {t.isActive === false
                  ? <button className="secondary" onClick={() => restore(t)}><RotateCcw size={14} /> Restore</button>
                  : <>
                    <button className="secondary" onClick={() => openRoster(t)}><UserPlus size={14} /> Members</button>
                    <button className="secondary" onClick={() => openEditor(t)}><Pencil size={14} /> Edit</button>
                    <button className="secondary" onClick={() => remove(t)} aria-label={`Remove ${t.name}`}><Trash2 size={14} /></button>
                  </>}
              </div>
            )}
          </article>
        ))}
        {!rows.length && <EmptyState icon={<Users />} title="No teams yet" text={manage ? "Create the first team above." : "Teams will appear here once the admin creates them."} />}
      </div>

      {editor && (
        <Shell title={editor.team ? "Edit team" : "New team"} onClose={() => setEditor(null)} foot={<><button className="secondary" onClick={() => setEditor(null)}>Cancel</button><button className="primary" disabled={form.name.trim().length < 2} onClick={saveTeam}>Save</button></>}>
          <div className="field"><label htmlFor="team-name">Team name</label><input id="team-name" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="team-desc">What does this team do?</label><textarea id="team-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <label className="check"><input type="checkbox" checked={form.clientVisible} onChange={(e) => setForm({ ...form, clientVisible: e.target.checked })} /> Clients can choose this team when raising tickets or requesting projects</label>
        </Shell>
      )}
      {rosterFor && (
        <Shell title={`Members of ${rosterFor.name}`} onClose={() => setRosterFor(null)} foot={<><button className="secondary" onClick={() => setRosterFor(null)}>Cancel</button><button className="primary" onClick={saveRoster}>Save members</button></>}>
          <p className="hint">Tick everyone who belongs to this team. A person can be in several teams. Removing someone does not delete their existing tickets or tasks.</p>
          <PeoplePicker users={staff.map((s) => ({ id: s.id, name: `${s.name || s.email} (${s.role.toLowerCase().replace("_", " ")})` }))} defaultValue={roster} onChange={setRoster} />
        </Shell>
      )}
    </>
  );
}
