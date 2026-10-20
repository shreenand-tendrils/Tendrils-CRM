import { useState } from "react";
import { X, ShieldCheck, Info } from "lucide-react";
import PeoplePicker from "../ui/PeoplePicker";
import { can } from "../../lib/rbac";
import { peopleOfTeams } from "../../lib/teams";
import TeamMultiSelect from "../ui/TeamMultiSelect";

// field = [name, label, type, required, visible(me)]
const configs = {
  ticket: { title: "Create a ticket", fields: [
    ["title", "Ticket title", "text", true], ["description", "Description", "textarea"],
    ["organizationId", "Client workspace", "clients", true], ["projectId", "Project", "projects"],
    ["teamId", "Team (choose first)", "teams", false, (me) => me.isInternal],
    ["teamIds", "Also share with other teams", "teamsMulti", false, (me) => can(me, "ticket.triage") || can(me, "work.cross_team")],
    ["assigneeId", "Assignee (from the selected team(s))", "teamAssignees", false, (me) => can(me, "ticket.triage") || can(me, "work.cross_team")],
    ["priority", "Priority", "priority"], ["visibility", "Visibility", "visibility", false, (me) => me.isInternal], ["dueDate", "Due date", "date"],
  ] },
  task: { title: "Create a task", fields: [
    ["title", "Task title", "text", true], ["description", "Description", "textarea"],
    ["organizationId", "Client workspace", "clients", true], ["projectId", "Project", "projects"], ["ticketId", "Related ticket", "tickets"],
    ["parentId", "Parent task (optional subtask)", "parentTasks"],
    ["teamId", "Team (choose first)", "teams", false, (me) => me.isInternal],
    ["teamIds", "Also share task with other teams", "teamsMulti", false, (me) => can(me, "task.assign") || can(me, "work.cross_team")],
    ["assigneeIds", "Assignees (from the selected team(s))", "teamPeople", false, (me) => can(me, "task.assign") || can(me, "work.cross_team")],
    ["priority", "Priority", "priority"], ["dueDate", "Due date", "date"],
  ] },
  project: { title: "Create a project", fields: [
    ["name", "Project name", "text", true], ["description", "Description", "textarea"], ["organizationId", "Client workspace", "clients", true],
    ["status", "Status", "projectStatus"], ["memberIds", "Team members (you are added as lead)", "people"], ["startDate", "Start date", "date"], ["dueDate", "Due date", "date"],
  ] },
  client: { title: "Add client workspace", fields: [["name", "Client name", "text", true], ["slug", "Workspace slug (lowercase, dashes)", "text", true]] },
};
const SELECTS = ["clients", "projects", "tickets", "users", "priority", "visibility", "projectStatus", "teams", "parentTasks", "teamAssignees"];

function optionsFor(type, data, orgId, teamIds = []) {
  const inOrg = (o) => !orgId || o.organizationId === orgId || o.organization?.id === orgId;
  const map = {
    clients: (data.organizations || []).filter((o) => o.type === "CLIENT").map((o) => [o.id, o.name]),
    projects: (data.projects || []).filter(inOrg).map((o) => [o.id, o.name]),
    tickets: (data.tickets || []).filter(inOrg).map((o) => [o.id, `${o.key} · ${o.title}`]),
    users: (data.users || []).map((o) => [o.id, o.name || o.email]),
    teamAssignees: peopleOfTeams(data.teams, teamIds).map((p) => [p.id, p.label]),
    teams: (data.teams || []).filter((team) => can(data.me, "ticket.triage") || can(data.me, "task.assign") || can(data.me, "work.cross_team") || team.members?.some((m) => m.membership?.user?.id === data.me.user?.id)).map((o) => [o.id, o.name]),
    parentTasks: (data.tasks || []).filter((task) => !task.autoCreated && (!orgId || task.organizationId === orgId)).map((o) => [o.id, o.title]),
    priority: [["LOW", "Low"], ["MEDIUM", "Medium"], ["HIGH", "High"], ["URGENT", "Urgent"]],
    visibility: [["CLIENT", "Client visible"], ["INTERNAL", "Internal only"]],
    projectStatus: [["ACTIVE", "Active"], ["PLANNING", "Planning"], ["ON_HOLD", "On hold"], ["COMPLETED", "Completed"]],
  };
  return [["", "— Select —"], ...(map[type] || [])];
}

export default function EntityModal({ kind, data, onClose, onSubmit, saving, initial = null }) {
  const [orgId, setOrgId] = useState(initial?.organizationId || "");
  const [teamId, setTeamId] = useState(initial?.teamId || "");
  const [sharedIds, setSharedIds] = useState([]);
  const config = configs[kind];
  const me = data.me;
  if (!config) return null;
  const pickedTeams = [teamId, ...sharedIds.filter((id) => id !== teamId)].filter(Boolean); // owner + shared teams
  const fields = config.fields.filter(([, , , , visible]) => !visible || visible(me));

  const submit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {};
    for (const [name, , type] of fields) {
      const v = ["people", "teamsMulti", "teamPeople"].includes(type) ? fd.getAll(name) : fd.get(name);
      if (Array.isArray(v) ? v.length : v !== "" && v != null) payload[name] = v;
    }
    onSubmit(kind, payload);
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} role="dialog" aria-label={config.title}>
        <div className="modal-head">
          <span><small>WORKSPACE</small><h2>{config.title}</h2></span>
          <button type="button" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body">
          {initial?.ticketId && <p className="hint"><Info size={13} style={{ verticalAlign: -2 }} /> Linked to {(data.tickets || []).find((t) => t.id === initial.ticketId)?.key || "the ticket"}. You can send it to another team below; it keeps the ticket’s route.</p>}
          {initial?.parentId && <p className="hint"><Info size={13} style={{ verticalAlign: -2 }} /> Subtask of {(data.tasks || []).find((t) => t.id === initial.parentId)?.title || "the parent task"}.</p>}
          {fields.map(([name, label, type, required]) => (
            <div className="field" key={name}>
              <label htmlFor={`f-${name}`}>{label}{required && <i> *</i>}</label>
              {type === "textarea" ? <textarea id={`f-${name}`} name={name} defaultValue={initial?.[name]} />
                : type === "people" ? <PeoplePicker name={name} users={data.users} />
                : type === "teamPeople" ? (teamId
                    ? <PeoplePicker key={pickedTeams.join("|")} name={name} users={peopleOfTeams(data.teams, pickedTeams).map((p) => ({ id: p.id, name: p.label }))} />
                    : <small className="hint">Select a team first, then pick people from it.</small>)
                : type === "teamsMulti" ? <><TeamMultiSelect id={`f-${name}`} name={name} teams={optionsFor("teams", data, orgId).filter(([v]) => v).map(([id, tname]) => ({ id, name: tname }))} value={sharedIds} onChange={setSharedIds} lockedId={teamId} disabled={!teamId} label={label} />{!teamId && <small className="hint">Choose the team first.</small>}</>
                : SELECTS.includes(type) ? (
                  <select id={`f-${name}`} name={name} required={required} defaultValue={initial?.[name] ?? ""} disabled={type === "teamAssignees" && !teamId}
                    onChange={name === "organizationId" ? (e) => setOrgId(e.target.value) : name === "teamId" ? (e) => setTeamId(e.target.value) : undefined}>
                    {type === "teamAssignees"
                      ? [[ "", teamId ? "— Unassigned —" : "Select a team first" ], ...optionsFor(type, data, orgId, pickedTeams).filter(([v]) => v)].map(([v, l]) => <option value={v} key={v}>{l}</option>)
                      : optionsFor(type, data, orgId, pickedTeams).map(([v, l]) => <option value={v} key={v}>{l}</option>)}
                  </select>
                ) : <input id={`f-${name}`} name={name} type={type} required={required} defaultValue={initial?.[name]} />}
              {name === "assigneeId" && <span className="hint"><Info size={13} style={{ verticalAlign: -2 }} /> A task is created for the assignee automatically.</span>}
            </div>
          ))}
          {kind === "task" && !can(me, "task.assign") && !can(me, "work.cross_team") && <p className="hint"><Info size={13} style={{ verticalAlign: -2 }} /> Tasks you create are assigned to you. Ask a manager to assign others.</p>}
        </div>
        <div className="modal-foot">
          <small><ShieldCheck size={14} /> Recorded in the activity log</small>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving}>{saving ? "Saving…" : "Create"}</button>
        </div>
      </form>
    </div>
  );
}
