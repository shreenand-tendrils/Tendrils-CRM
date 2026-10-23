import { useState } from "react";
import { Check, Plus, ShieldCheck, Undo2, Play, Send, RotateCcw } from "lucide-react";
import { api } from "../../api";
import { can, canEditTask } from "../../lib/rbac";
import { statusRights, REVIEW_HINT, REVIEW_LABEL } from "../../lib/taskReview";
import { subtasksOf, subtaskStats, personName } from "../../lib/workThread";
import { StatusBadge } from "../ui/StatusBadge";
import "../../styles/workflow.css";

const STEPS = [["TODO", "To do"], ["IN_PROGRESS", "In progress"], ["REVIEW", "In review"], ["DONE", "Done"]];
const stepIndex = (s) => (s === "BACKLOG" ? 0 : s === "BLOCKED" ? 1 : Math.max(0, STEPS.findIndex(([k]) => k === s)));

const waitingFor = (task, authority) => authority === "CLIENT" ? "the client" : authority === "TEAM"
  ? ((task.teamAccesses || []).filter((a) => a.accessRole === "REVIEWER").map((a) => a.team?.name).filter(Boolean).join(", ") || "the requesting team") : "a teammate";

/** One clear "what happens next" bar for a task: where it is, who reviews it, and the single next action. */
export function TaskWorkflowBar({ task, tasks, me, onStatusChange }) {
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : null;
  const parentIds = parent ? [parent.assigneeId, ...(parent.assignees || []).map((a) => a.user?.id)].filter(Boolean) : [];
  const r = statusRights(me, task, parentIds);
  const { authority } = r;
  const { done, total } = subtaskStats(task.id, tasks);
  const pending = total - done;
  const at = stepIndex(task.status);
  const go = (status) => onStatusChange?.(task, status);
  const owners = (task.assignees || []).map((a) => personName(a.user)).filter(Boolean).join(", ");
  let actions = null;
  if (authority === "TICKET") actions = <p className="hint">{REVIEW_HINT.TICKET}</p>;
  else if (task.status === "REVIEW") {
    actions = r.canApproveNow
      ? <><button className="primary" onClick={() => go("DONE")}><Check size={14} /> Approve · mark done</button><button className="secondary" onClick={() => go("IN_PROGRESS")}><Undo2 size={14} /> Send back</button></>
      : <p className="hint" role="status">Waiting for {waitingFor(task, authority)} to review.{r.isAssignee && authority !== "CLIENT" && authority !== "TEAM" ? " You cannot approve your own work." : ""}</p>;
  } else if (task.status === "DONE") {
    actions = r.canApproveNow ? <button className="secondary" onClick={() => go("IN_PROGRESS")}><RotateCcw size={14} /> Reopen</button> : <p className="hint">Done. Only the reviewer can reopen it.</p>;
  } else if (!r.asDoer) {
    actions = <p className="hint">Only {owners || "the assignee"} can move this task. You can follow it and comment.</p>;
  } else if (["BACKLOG", "TODO"].includes(task.status)) actions = <button className="primary" onClick={() => go("IN_PROGRESS")}><Play size={14} /> Start work</button>;
  else {
    actions = pending > 0
      ? <p className="hint" role="status">Finish the {pending} open subtask{pending === 1 ? "" : "s"} below first.</p>
      : authority === "NONE"
        ? <button className="primary" onClick={() => go("DONE")}><Check size={14} /> Mark done</button>
        : <button className="primary" onClick={() => go("REVIEW")}><Send size={14} /> Submit for review</button>;
    actions = <>{actions}{task.status === "IN_PROGRESS" ? <button className="secondary" onClick={() => go("BLOCKED")}>Blocked</button> : <button className="secondary" onClick={() => go("IN_PROGRESS")}>Unblock</button>}</>;
  }

  return (
    <div className="wf-bar" aria-label="Task workflow">
      <ol className="wf-steps">
        {STEPS.filter(([k]) => authority !== "NONE" || k !== "REVIEW").map(([k, label]) => {
          const i = STEPS.findIndex(([x]) => x === k);
          return <li key={k} className={i < at ? "past" : i === at ? "now" : ""}><i />{label}</li>;
        })}
      </ol>
      {authority !== "TICKET" && <p className="wf-review"><ShieldCheck size={14} /> <b>{REVIEW_LABEL[authority]}</b> — {REVIEW_HINT[authority]}</p>}
      <div className="row wf-actions">{actions}</div>
    </div>
  );
}

/** Checklist of subtasks: tick them off, add one in a line, open one for detail. */
export function SubtaskChecklist({ task, tasks, me, onOpenTask, onRefresh, notify }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const kids = subtasksOf(task.id, tasks);
  const { done, total } = subtaskStats(task.id, tasks);
  const locked = ["REVIEW", "DONE"].includes(task.status);
  const canAdd = can(me, "task.create") && !task.autoCreated && !locked && canEditTask(me, task);
  const fail = (err, fallback) => notify?.(err.response?.data?.error || fallback, "error");

  const toggle = async (k) => {
    try { await api.patch(`/tasks/${k.id}`, { status: k.status === "DONE" ? "TODO" : "DONE" }); onRefresh?.(); } catch (err) { fail(err, "Could not update the subtask"); }
  };
  const add = async (e) => {
    e.preventDefault();
    if (title.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      await api.post("/tasks", {
        title: title.trim(), organizationId: task.organizationId, parentId: task.id,
        ...(task.ticketId ? { ticketId: task.ticketId } : {}), ...(task.projectId ? { projectId: task.projectId } : {}), ...(task.teamId ? { teamId: task.teamId } : {}),
        assigneeIds: (task.assignees || []).map((a) => a.user?.id || a.userId).filter(Boolean),
      });
      setTitle(""); onRefresh?.();
    } catch (err) { fail(err, "Could not add the subtask"); } finally { setBusy(false); }
  };

  if (task.autoCreated || (!total && !canAdd)) return null;
  return (
    <section className="subtasks" aria-label="Subtasks">
      <header>
        <h4>Subtasks</h4>
        {total > 0 && <span className="muted">{done}/{total} done</span>}
      </header>
      {total > 0 && <div className="progress" aria-hidden="true"><i style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>}
      <ul>
        {kids.map((k) => {
          const mineToTick = statusRights(me, k, [task.assigneeId, ...(task.assignees || []).map((a) => a.user?.id)].filter(Boolean)).asDoer;
          return (
            <li key={k.id} className={k.status === "DONE" ? "done" : ""}>
              <input type="checkbox" checked={k.status === "DONE"} disabled={!mineToTick} onChange={() => toggle(k)} aria-label={`Mark subtask ${k.title} ${k.status === "DONE" ? "not done" : "done"}`} />
              <button type="button" className="linklike" onClick={() => onOpenTask?.(k)}>{k.title}</button>
              <small className="muted">{(k.assignees || []).map((a) => personName(a.user)).filter(Boolean).join(", ") || "Unassigned"}</small>
              {k.status !== "DONE" && k.status !== "TODO" && <StatusBadge value={k.status} />}
            </li>
          );
        })}
      </ul>
      {canAdd
        ? <form className="subtask-add" onSubmit={add}><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a subtask and press Enter" aria-label="New subtask title" /><button className="secondary" type="submit" disabled={busy || title.trim().length < 2}><Plus size={14} /> Add</button></form>
        : locked && <p className="hint">Move the task back to In progress to add subtasks.</p>}
    </section>
  );
}
