import { useEffect, useState } from "react";
import { X, Plus, Ticket as TicketIcon, UploadCloud } from "lucide-react";
import { api } from "../../api";
import TaskComments from "./TaskComments";
import TicketAttachments from "../tickets/TicketAttachments";
import { formatDate } from "../../lib/formatters";
import { PriorityBadge, StatusBadge } from "../ui/StatusBadge";
import { can, canEditTask } from "../../lib/rbac";
import { COLUMNS } from "./TaskBoard";
import WorkThread from "../work/WorkThread";
import { collectThread, taskPeople, taskTeams } from "../../lib/workThread";

// Task detail + its route: the ticket it came from, the teams and people on it, parent task and subtasks.
export default function TaskDrawer({ task, tasks = [], tickets = [], me, onClose, onStatusChange, onOpenTask, onOpenTicket, onAddSubtask, onRefresh, notify }) {
  const [tab, setTab] = useState("comments");
  useEffect(() => { setTab("comments"); }, [task?.id]);
  if (!task) return null;
  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData(); fd.append("file", file); fd.append("taskId", task.id);
    try { await api.post("/files", fd); notify?.("File uploaded"); onRefresh?.(); }
    catch (err) { notify?.(err.response?.data?.error || "Upload failed", "error"); }
    finally { e.target.value = ""; }
  };
  const nComments = task._count?.comments || 0, nFiles = task._count?.attachments || 0;
  const ticketFull = tickets.find((t) => t.id === task.ticketId);
  const ticket = ticketFull || (task.ticket ? { id: task.ticket.id, key: task.ticket.key, title: task.ticket.title } : null);
  const { owner, shared } = taskTeams(task);
  const people = taskPeople(task);
  const editable = canEditTask(me, task);
  const thread = collectThread(tasks, { ticketId: task.ticketId, focusId: task.id });

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Task ${task.title}`}>
        <div className="drawer-head"><b>{task.autoCreated ? "Auto task" : task.parentId ? "Subtask" : "Task"}</b><button onClick={onClose} aria-label="Close"><X /></button></div>
        <h2>{task.title}</h2>
        <p>{task.description || "No description added."}</p>

        <div className="detail"><span>Status</span>
          {editable
            ? <select className="table-select" value={task.status} onChange={(e) => onStatusChange(task, e.target.value)} aria-label="Task status">{COLUMNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            : <StatusBadge value={task.status} />}
        </div>
        <div className="detail"><span>Priority</span><PriorityBadge value={task.priority} /></div>
        <div className="detail"><span>Due</span><b>{formatDate(task.dueDate)}</b></div>
        <div className="detail"><span>Client</span><b>{task.organization?.name || "—"}</b></div>
        {task.project && <div className="detail"><span>Project</span><b>{task.project.name}</b></div>}
        <div className="detail"><span>Team</span><b>{owner || "Not set"}{shared.length ? ` (+${shared.join(", ")})` : ""}</b></div>
        <div className="detail"><span>Assignees</span><b>{people.length ? people.join(", ") : "Unassigned"}</b></div>
        {task.creator && <div className="detail"><span>Created by</span><b>{task.creator.name || task.creator.email}</b></div>}
        {task.autoCreated && <p className="hint">This task mirrors its ticket: changing its status moves the ticket too. Add a linked task from the ticket for extra work.</p>}

        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {can(me, "task.create") && !task.autoCreated && <button className="primary" onClick={() => onAddSubtask(task)}><Plus size={14} /> Add subtask</button>}
          {ticketFull && <button className="secondary" onClick={() => onOpenTicket(ticketFull)}><TicketIcon size={14} /> Open {ticketFull.key}</button>}
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
      </aside>
    </>
  );
}
