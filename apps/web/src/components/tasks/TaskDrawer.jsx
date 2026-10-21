import { useEffect, useState } from "react";
import { Plus, Ticket as TicketIcon, UploadCloud } from "lucide-react";
import { api } from "../../api";
import { formatDate } from "../../lib/formatters";
import { clipboardFiles, appendLine, PASTE_MARK } from "../../lib/paste";
import { PriorityBadge, StatusBadge } from "../ui/StatusBadge";
import { can, canEditTask } from "../../lib/rbac";
import { COLUMNS } from "./TaskBoard";
import Window from "../ui/Window";
import WorkThread from "../work/WorkThread";
import TaskComments from "./TaskComments";
import TicketAttachments from "../tickets/TicketAttachments";
import { collectThread, taskPeople, taskTeams } from "../../lib/workThread";

// Floating task window: description, comments, files and the route (ticket -> teams -> tasks) on the left, details on the right.
export default function TaskDrawer({ task, tasks = [], tickets = [], me, onClose, onStatusChange, onOpenTask, onOpenTicket, onAddSubtask, onRefresh, notify, doneLocked, teams = [], onReassign }) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState("");
  const [tab, setTab] = useState("comments");
  const [reassignTeamId, setReassignTeamId] = useState("");
  useEffect(() => { setTab("comments"); setEditing(false); setReassignTeamId(task?.teamId || ""); }, [task?.id, task?.teamId]);
  if (!task) return null;
  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData(); fd.append("file", file); fd.append("taskId", task.id);
    try { await api.post("/files", fd); notify?.("File uploaded"); onRefresh?.(); }
    catch (err) { notify?.(err.response?.data?.error || "Upload failed", "error"); }
    finally { e.target.value = ""; }
  };
  const attach = async (file) => {
    const fd = new FormData(); fd.append("file", file); fd.append("taskId", task.id);
    try { await api.post("/files", fd); onRefresh?.(); } catch (err) { notify?.(err.response?.data?.error || "Could not attach the pasted file", "error"); }
  };
  const saveDesc = async () => {
    try { await api.patch(`/tasks/${task.id}`, { description: desc }); setEditing(false); notify?.("Description saved"); onRefresh?.(); }
    catch (err) { notify?.(err.response?.data?.error || "Could not save", "error"); }
  };
  const nComments = task._count?.comments || 0, nFiles = task._count?.attachments || 0;
  const ticketFull = tickets.find((t) => t.id === task.ticketId);
  const ticket = ticketFull || (task.ticket ? { id: task.ticket.id, key: task.ticket.key, title: task.ticket.title } : null);
  const { owner, shared } = taskTeams(task);
  const people = taskPeople(task);
  const editable = canEditTask(me, task);
  const thread = collectThread(tasks, { ticketId: task.ticketId, focusId: task.id });
  const kind = task.autoCreated ? "Auto task" : task.parentId ? "Subtask" : "Task";

  const side = (
    <>
      <div className="win-card">
        <div className="detail"><span>Status</span>
          {editable
            ? <select className="table-select" value={task.status} onChange={(e) => onStatusChange(task, e.target.value)} aria-label="Task status">{COLUMNS.map(([v, l]) => <option key={v} value={v} disabled={v === "DONE" && doneLocked?.(task) && task.status !== "DONE"}>{l}{v === "DONE" && doneLocked?.(task) && task.status !== "DONE" ? "" : ""}</option>)}</select>
            : <StatusBadge value={task.status} />}
        </div>
        <div className="detail"><span>Priority</span><PriorityBadge value={task.priority} /></div>
        <div className="detail"><span>Created</span><b>{formatDate(task.createdAt)}</b></div>
        <div className="detail"><span>Days open</span><b>{Math.max(0, Math.floor((Date.now() - new Date(task.createdAt || Date.now()).getTime()) / 86400000))} days</b></div>
        <div className="detail"><span>Due</span><b>{formatDate(task.dueDate)}</b></div>
        <div className="detail"><span>Client</span><b>{task.organization?.name || "—"}</b></div>
        {task.project && <div className="detail"><span>Project</span><b>{task.project.name}</b></div>}
        <div className="detail"><span>Team</span><b>{owner || "Not set"}{shared.length ? ` (+${shared.join(", ")})` : ""}</b></div>
        <div className="detail"><span>Assignees</span><b>{people.length ? people.join(", ") : "Unassigned"}</b></div>
        {can(me, "task.assign") && !task.autoCreated && <div className="detail" style={{ display: "grid", gap: 8, minWidth: 0 }}><span>Reassign task</span><label className="muted" htmlFor="task-reassign-team">Team</label><select id="task-reassign-team" className="table-select" value={reassignTeamId} onChange={(e) => { setReassignTeamId(e.target.value); onReassign?.(task, { teamId: e.target.value || null, assigneeId: null }); }}><option value="">Choose a team</option>{teams.filter((tm) => [task.teamId, ...(task.teamAccesses || []).map((a) => a.teamId)].includes(tm.id) || tm.members?.some((m) => m.membership?.user?.id === me?.user?.id)).map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}</select><label className="muted" htmlFor="task-reassign-person">Employee</label><select id="task-reassign-person" className="table-select" value={task.assigneeId || ""} disabled={!reassignTeamId} onChange={(e) => onReassign?.(task, { teamId: reassignTeamId, assigneeId: e.target.value || null })}><option value="">Unassigned</option>{(teams.find((tm) => tm.id === reassignTeamId)?.members || []).map((m) => m.membership?.user).filter(Boolean).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select></div>}
        {task.creator && <div className="detail"><span>Created by</span><b>{task.creator.name || task.creator.email}</b></div>}
      </div>
      {task.autoCreated && <p className="hint">This task mirrors its ticket: changing its status moves the ticket too. Add a linked task from the ticket for extra work.</p>}
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {can(me, "task.create") && !task.autoCreated && <button className="primary" onClick={() => onAddSubtask(task)}><Plus size={14} /> Add subtask</button>}
        {ticketFull && <button className="secondary" onClick={() => onOpenTicket(ticketFull)}><TicketIcon size={14} /> Open {ticketFull.key}</button>}
      </div>
    </>
  );

  return (
    <Window label={`Task ${task.title}`} onClose={onClose} side={side} head={<><b className="win-key">{kind}</b><StatusBadge value={task.status} /><PriorityBadge value={task.priority} /></>}>
      <div>
        <h2>{task.title}</h2>
        {editing ? (
          <div className="field">
            <textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Task description" placeholder="Describe the task here" />
            <div className="row"><button className="primary" onClick={saveDesc}>Save description</button><button className="secondary" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        ) : (
          <p style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{task.description || "No description added."} {editable && <button className="secondary" style={{ marginLeft: 6 }} onClick={() => { setDesc(task.description || ""); setEditing(true); }}>Edit</button>}</p>
        )}
      </div>
      <div className="drawer-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "comments"} className={tab === "comments" ? "tab on" : "tab"} onClick={() => setTab("comments")}>Comments ({nComments})</button>
        <button role="tab" aria-selected={tab === "route"} className={tab === "route" ? "tab on" : "tab"} onClick={() => setTab("route")}>Route</button>
        <button role="tab" aria-selected={tab === "files"} className={tab === "files" ? "tab on" : "tab"} onClick={() => setTab("files")}>Files ({nFiles})</button>
      </div>
      {tab === "comments" && <TaskComments task={task} me={me} canComment={can(me, "ticket.comment_internal")} onChanged={onRefresh} notify={notify} />}
      {tab === "route" && (
        <WorkThread
          ticket={ticket} ticketId={ticketFull ? task.ticketId : null} tasks={thread} focusTaskId={task.id}
          onOpenTask={onOpenTask} onOpenTicket={ticketFull ? onOpenTicket : null} refreshKey={`${task.updatedAt}|${thread.length}`}
        />
      )}
      {tab === "files" && (
        <>
          {can(me, "file.upload") && <label className="upload"><UploadCloud /><span>Upload an image or document<input type="file" accept="image/*,.pdf,.doc,.docx,.txt" onChange={upload} /></span></label>}
          <TicketAttachments endpoint={`/tasks/${task.id}/attachments`} refreshKey={nFiles} />
        </>
      )}
    </Window>
  );
}
