import { useState } from "react";
import { X, ShieldCheck, Info } from "lucide-react";
import PeoplePicker from "../ui/PeoplePicker";
import { can } from "../../lib/rbac";

// field = [name, label, type, required, visible(me)]
const configs = {
  ticket: { title: "Create a ticket", fields: [
    ["title", "Ticket title", "text", true], ["description", "Description", "textarea"],
    ["organizationId", "Client workspace", "clients", true], ["projectId", "Project", "projects"],
    ["assigneeId", "Assignee", "users", false, (me) => can(me, "ticket.triage")],
    ["priority", "Priority", "priority"], ["visibility", "Visibility", "visibility", false, (me) => me.isInternal], ["dueDate", "Due date", "date"],
  ] },
  task: { title: "Create a task", fields: [
    ["title", "Task title", "text", true], ["description", "Description", "textarea"],
    ["organizationId", "Client workspace", "clients", true], ["projectId", "Project", "projects"], ["ticketId", "Related ticket", "tickets"],
    ["assigneeIds", "Assignees (one or more)", "people", false, (me) => can(me, "task.assign")],
    ["priority", "Priority", "priority"], ["dueDate", "Due date", "date"],
  ] },
  project: { title: "Create a project", fields: [
    ["name", "Project name", "text", true], ["description", "Description", "textarea"], ["organizationId", "Client workspace", "clients", true],
    ["status", "Status", "projectStatus"], ["memberIds", "Team members (you are added as lead)", "people"], ["startDate", "Start date", "date"], ["dueDate", "Due date", "date"],
  ] },
  client: { title: "Add client workspace", fields: [["name", "Client name", "text", true], ["slug", "Workspace slug (lowercase, dashes)", "text", true]] },
};
const SELECTS = ["clients", "projects", "tickets", "users", "priority", "visibility", "projectStatus"];

function optionsFor(type, data, orgId) {
  const inOrg = (o) => !orgId || o.organizationId === orgId || o.organization?.id === orgId;
  const map = {
    clients: (data.organizations || []).filter((o) => o.type === "CLIENT").map((o) => [o.id, o.name]),
    projects: (data.projects || []).filter(inOrg).map((o) => [o.id, o.name]),
    tickets: (data.tickets || []).filter(inOrg).map((o) => [o.id, `${o.key} · ${o.title}`]),
    users: (data.users || []).map((o) => [o.id, o.name || o.email]),
    priority: [["LOW", "Low"], ["MEDIUM", "Medium"], ["HIGH", "High"], ["URGENT", "Urgent"]],
    visibility: [["CLIENT", "Client visible"], ["INTERNAL", "Internal only"]],
    projectStatus: [["ACTIVE", "Active"], ["PLANNING", "Planning"], ["ON_HOLD", "On hold"], ["COMPLETED", "Completed"]],
  };
  return [["", "— Select —"], ...(map[type] || [])];
}

export default function EntityModal({ kind, data, onClose, onSubmit, saving }) {
  const [orgId, setOrgId] = useState("");
  const config = configs[kind];
  const me = data.me;
  if (!config) return null;
  const fields = config.fields.filter(([, , , , visible]) => !visible || visible(me));

  const submit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {};
    for (const [name, , type] of fields) {
      const v = type === "people" ? fd.getAll(name) : fd.get(name);
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
          {fields.map(([name, label, type, required]) => (
            <div className="field" key={name}>
              <label htmlFor={`f-${name}`}>{label}{required && <i> *</i>}</label>
              {type === "textarea" ? <textarea id={`f-${name}`} name={name} />
                : type === "people" ? <PeoplePicker name={name} users={data.users} />
                : SELECTS.includes(type) ? (
                  <select id={`f-${name}`} name={name} required={required} onChange={name === "organizationId" ? (e) => setOrgId(e.target.value) : undefined}>
                    {optionsFor(type, data, orgId).map(([v, l]) => <option value={v} key={v}>{l}</option>)}
                  </select>
                ) : <input id={`f-${name}`} name={name} type={type} required={required} />}
              {name === "assigneeId" && <span className="hint"><Info size={13} style={{ verticalAlign: -2 }} /> A task is created for the assignee automatically.</span>}
            </div>
          ))}
          {kind === "task" && !can(me, "task.assign") && <p className="hint"><Info size={13} style={{ verticalAlign: -2 }} /> Tasks you create are assigned to you. Ask a team lead to assign others.</p>}
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
