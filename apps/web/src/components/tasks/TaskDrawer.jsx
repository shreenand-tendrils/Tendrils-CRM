import { useEffect, useState } from "react";
import { Plus, Ticket as TicketIcon, UploadCloud } from "lucide-react";
import { api } from "../../api";
import { formatDate } from "../../lib/formatters";
import { clipboardFiles, appendLine, uploadInline, isImage, IMG_MARK } from "../../lib/paste";
import RichText from "../ui/RichText";
import PeoplePicker from "../ui/PeoplePicker";
import TeamMultiSelect from "../ui/TeamMultiSelect";
import { peopleOfTeams } from "../../lib/teams";
import { daysPassed, dayLabel } from "../../lib/ticketStatus";
import { PriorityBadge, StatusBadge } from "../ui/StatusBadge";
import { can, canEditTask } from "../../lib/rbac";
import { COLUMNS } from "./TaskBoard";
import Window from "../ui/Window";
import WorkThread from "../work/WorkThread";
import TaskComments from "./TaskComments";
import TicketAttachments from "../tickets/TicketAttachments";
import { collectThread, taskPeople, taskTeams } from "../../lib/workThread";

// Floating task window: description, comments, files and the route (ticket -> teams -> tasks) on the left, details on the right.
export default function TaskDrawer({ task, tasks = [], tickets = [], me, onClose, onStatusChange, onOpenTask, onOpenTicket, onAddSubtask, onRefresh, notify, teams = [] }) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState("");
  const [ownerTeam, setOwnerTeam] = useState(task?.teamId || "");
  const [sharedTeams, setSharedTeams] = useState((task?.teamAccesses || []).filter((a) => a.teamId !== task?.teamId).map((a) => a.teamId));
  const [assigneeIds, setAssigneeIds] = useState((task?.assignees || []).map((a) => a.user?.id || a.userId).filter(Boolean));
  const [tab, setTab] = useState("comments");
  useEffect(() => { setTab("comments"); setEditing(false); setOwnerTeam(task?.teamId || ""); setSharedTeams((task?.teamAccesses || []).filter((a) => a.teamId !== task?.teamId).map((a) => a.teamId)); setAssigneeIds((task?.assignees || []).map((a) => a.user?.id || a.userId).filter(Boolean)); }, [task?.id, task?.updatedAt]);
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
  const ticket = ticketFull || (task.ticket ? { id: task.ticket.id, key: task.ticket.key, title: task.ticket.title, status: task.ticket.status } : null);
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
            ? <select disabled={(task.status === "DONE" && !can(me, "task.update_any")) || (task.autoCreated && ["REVIEW_TEST", "REVIEW_HELP", "CLOSED"].includes(ticket?.status))} className="table-select" value={task.status} onChange={(e) => onStatusChange(task, e.target.value)} aria-label="Task status">{COLUMNS.map(([v, l]) => { const doneBlocked = v === "DONE" && (task.autoCreated || !can(me, "task.update_any")) && task.status !== "DONE"; return <option key={v} value={v} disabled={doneBlocked}>{l}{doneBlocked ? (task.autoCreated ? " (client approval required)" : " (reviewer approval required)") : ""}</option>; })}</select>
            : <StatusBadge value={task.status} />}
        </div>
        <div className="detail"><span>Priority</span><PriorityBadge value={task.priority} /></div>
        <div className="detail"><span>Opened</span><b>{formatDate(task.createdAt)}</b></div>
        <div className="detail"><span>Due</span><b>{formatDate(task.dueDate)}</b></div>
        <div className="detail"><span>{task.completedAt ? "Done in" : "Open for"}</span><b>{dayLabel(daysPassed(task, "completedAt"))}</b></div>
        <div className="detail"><span>Client</span><b>{task.organization?.name || "—"}</b></div>
        {task.project && <div className="detail"><span>Project</span><b>{task.project.name}</b></div>}
        <div className="detail"><span>Team</span><b>{owner || "Not set"}{shared.length ? ` (+${shared.join(", ")})` : ""}</b></div>
        <div className="detail"><span>Assignees</span><b>{people.length ? people.join(", ") : "Unassigned"}</b></div>
        {task.creator && <div className="detail"><span>Created by</span><b>{task.creator.name || task.creator.email}</b></div>}
      </div>
      {can(me, "task.assign") && !task.autoCreated && (
        <div className="win-card" style={{ padding: 12, gap: 8 }}>
          <h4>Reassign</h4>
          <div className="field"><label>Team</label>
            <select value={ownerTeam} onChange={(e) => { setOwnerTeam(e.target.value); setAssigneeIds([]); }} aria-label="Owning team"><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </div>
          <div className="field"><label>Also share with</label><TeamMultiSelect teams={teams} value={sharedTeams} onChange={setSharedTeams} lockedId={ownerTeam} disabled={!ownerTeam} /></div>
          <div className="field"><label>Assignees (people of those teams)</label>
            {ownerTeam
              ? <PeoplePicker key={[ownerTeam, ...sharedTeams].join("|")} users={peopleOfTeams(teams, [ownerTeam, ...sharedTeams]).map((p) => ({ id: p.id, name: p.label }))} defaultValue={assigneeIds} onChange={setAssigneeIds} />
              : <small className="hint">Choose a team first.</small>}
          </div>
          <button className="primary" disabled={!ownerTeam} onClick={async () => { try { await api.patch(`/tasks/${task.id}`, { teamId: ownerTeam, teamIds: sharedTeams.filter((x) => x !== ownerTeam), assigneeIds }); notify?.("Task reassigned"); onRefresh?.(); } catch (err) { notify?.(err.response?.data?.error || "Could not reassign", "error"); } }}>Save reassignment</button>
        </div>
      )}
      {task.autoCreated && <p className="hint">This task mirrors its ticket: Open → In progress, Review/Test → Review, Review/Help → Blocked, and only client approval closes the ticket and marks this task Done. Don’t change a mirror task while the ticket is waiting for the client; reassign it from the ticket window.</p>}
      {!task.autoCreated && !can(me, "task.update_any") && <p className="hint">Submit finished work by moving the task to Review. Only an authorized reviewer can mark it Done.</p>}
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
            <textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Task description" placeholder="Paste a screenshot or PDF here with Ctrl+V to attach it"
              onPaste={async (e) => { const files = clipboardFiles(e); if (!files.length) return; e.preventDefault(); try { const marks = []; for (const f of files) { if (isImage(f)) marks.push(IMG_MARK((await uploadInline(f, { taskId: task.id })).id)); else await attach(f); } if (marks.length) setDesc((v) => appendLine(v, marks.join("\n"))); } catch { notify?.("Could not paste the image", "error"); } }} />
            {/\[\[img:/.test(desc) && <RichText text={desc} style={{ marginTop: 8, maxWidth: 420 }} />}
            <div className="row"><button className="primary" onClick={saveDesc}>Save description</button><button className="secondary" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        ) : (
          <div style={{ marginTop: 6 }}><RichText text={task.description || "No description added."} canDelete={editable} />{editable && <button className="secondary" onClick={() => { setDesc(task.description || ""); setEditing(true); }}>Edit description</button>}</div>
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
