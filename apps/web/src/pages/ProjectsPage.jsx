import { useState } from "react";
import { Link } from "react-router-dom";
import { FolderKanban, CalendarDays, MessagesSquare, Users, X, Megaphone } from "lucide-react";
import ProjectUpdatesModal from "../components/projects/ProjectUpdatesModal";
import Panel from "../components/ui/Panel";
import EmptyState from "../components/ui/EmptyState";
import AvatarStack from "../components/ui/AvatarStack";
import PeoplePicker from "../components/ui/PeoplePicker";
import { api } from "../api";
import { can } from "../lib/rbac";
import { formatDate, pretty } from "../lib/formatters";

function TeamModal({ project, users, teams = [], onClose, onSaved, notify }) {
  const [teamIds, setTeamIds] = useState((project.teams || []).map((t) => t.teamId));
  const current = (project.members || []).map((m) => m.userId);
  const [ids, setIds] = useState(current);
  const [lead, setLead] = useState((project.members || []).find((m) => m.role === "LEAD")?.userId || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/projects/${project.id}/members`, { memberIds: ids, leadId: lead || undefined, teamIds });
      notify("Team updated");
      onSaved();
      onClose();
    } catch (e) {
      notify(e.response?.data?.error || "Could not update team", "error");
    } finally { setSaving(false); }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head"><span><small>PROJECT TEAM</small><h2>{project.name}</h2></span><button type="button" onClick={onClose}><X /></button></div>
        <div className="modal-body">
          <div className="field"><label>Members</label><PeoplePicker users={users} defaultValue={current} onChange={setIds} /></div>
          {!!teams.length && <div className="field"><label>Teams this project is for</label><div className="check-grid">{teams.map((t) => <label key={t.id} className="check"><input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => setTeamIds((cur) => (cur.includes(t.id) ? cur.filter((x) => x !== t.id) : [...cur, t.id]))} /> {t.name}</label>)}</div></div>}
          <div className="field"><label htmlFor="lead">Project lead</label>
            <select id="lead" value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">— Keep current —</option>
              {users.filter((u) => ids.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-foot"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving || !ids.length} onClick={save}>{saving ? "Saving…" : "Save team"}</button></div>
      </div>
    </div>
  );
}

export default function ProjectsPage({ data, onRefresh, notify }) {
  const rows = data.projects || [];
  const [teamFor, setTeamFor] = useState(null);
  const [updatesFor, setUpdatesFor] = useState(null);
  const internal = !!data.me?.isInternal;
  const me = data.me;
  const canPost = (p) => internal && (can(me, "project.post_update") || (p.members || []).some((m) => m.userId === me?.user?.id));
  const canTeam = (p) => can(me, "project.manage_team") || (p.members || []).some((m) => m.userId === me?.user?.id && m.role === "LEAD");

  return (
    <Panel title="Projects" sub="Milestones, teams and delivery across client work">
      <div className="project-grid">
        {rows.map((project) => (
          <article className="project-card" key={project.id}>
            <div className="project-icon"><FolderKanban /></div>
            <span className="status">{pretty(project.status)}{project.requestedByClient ? " · Requested by client" : ""}</span>
            <h3>{project.name}</h3>
            <p>{project.description || "A shared space for project work, tasks and client updates."}</p>
            <div className="project-meta">
              <span>{project.organization?.name || "Internal"}</span>
              <span><CalendarDays size={13} />{formatDate(project.dueDate)}</span>
            </div>
            {!!project.teams?.length && <div className="chips">{project.teams.map((t) => <i className="chip-link" key={t.teamId}>{t.team?.name}</i>)}</div>}
            <div className="project-counts">
              <span>{project._count?.tickets || 0} tickets</span>
              <span>{project._count?.tasks || 0} tasks</span>
            </div>
            <div className="project-team"><button className="secondary" onClick={() => setUpdatesFor(project)}><Megaphone size={15} /> Updates</button></div>
            {internal && (
              <div className="project-team">
                <AvatarStack users={(project.members || []).map((m) => m.user)} max={4} />
                <span className="spacer" />
                {canTeam(project) && <button className="secondary" onClick={() => setTeamFor(project)}><Users size={15} /> Team</button>}
                {project.chatRoom && <Link className="secondary" to={`/chat?room=${project.chatRoom.id}`}><MessagesSquare size={15} /> Chat</Link>}
              </div>
            )}
          </article>
        ))}
        {!rows.length && <EmptyState icon={<FolderKanban />} title="No projects yet" text="Create a project to organize tasks and client requests." />}
      </div>
      {updatesFor && <ProjectUpdatesModal project={updatesFor} canPost={canPost(updatesFor)} onClose={() => setUpdatesFor(null)} notify={notify} />}
      {teamFor && <TeamModal project={teamFor} users={data.users || []} teams={data.teams || []} onClose={() => setTeamFor(null)} onSaved={onRefresh} notify={notify} />}
    </Panel>
  );
}
