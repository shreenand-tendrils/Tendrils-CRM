import { Plus, Ticket, MessageSquare, Paperclip } from "lucide-react";
import { formatDate, isOverdue } from "../../lib/formatters";
import AvatarStack from "../ui/AvatarStack";
import { PriorityBadge } from "../ui/StatusBadge";
import { can, canEditTask, canReviewTask } from "../../lib/rbac";
import { incompleteSubtaskCount } from "../../lib/workThread";

export const COLUMNS = [["BACKLOG", "Backlog"], ["TODO", "To do"], ["IN_PROGRESS", "In progress"], ["BLOCKED", "Blocked"], ["REVIEW", "Ready for review"], ["DONE", "Done"]];

export default function TaskBoard({ tasks = [], me, onStatusChange, onCreate, onOpen, doneLocked }) {
  return (
    <div className="task-board">
      {COLUMNS.map(([key, label]) => {
        const list = tasks.filter((t) => t.status === key);
        return (
          <section className="task-column" key={key} aria-label={label}>
            <header><span>{label}</span><b>{list.length}</b></header>
            <div className="task-cards">
              {list.map((t) => (
                <article className="task-card" key={t.id} style={onOpen ? { cursor: "pointer" } : undefined} tabIndex={onOpen ? 0 : undefined} role={onOpen ? "button" : undefined} aria-label={onOpen ? `Open task ${t.title}` : undefined} onClick={() => onOpen?.(t)} onKeyDown={(e) => { if (onOpen && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(t); } }}>
                  <div className="task-card-top">
                    <PriorityBadge value={t.priority} />
                    <select aria-label="Change task status" onClick={(e) => e.stopPropagation()} value={t.status} disabled={!canEditTask(me, t) || (t.status === "DONE" && !canReviewTask(me, t)) || (t.autoCreated && ["REVIEW_TEST", "REVIEW_HELP", "CLOSED"].includes(t.ticket?.status))} title={!canEditTask(me, t) ? "You can only move tasks assigned to you" : t.autoCreated && ["REVIEW_TEST", "REVIEW_HELP", "CLOSED"].includes(t.ticket?.status) ? "Ticket is waiting for the client; use the ticket review actions" : t.status === "DONE" && !canReviewTask(me, t) ? "Only the review team can reopen a completed task" : undefined} onChange={(e) => onStatusChange(t, e.target.value)}>
                      {COLUMNS.map(([v, l]) => { const doneBlocked = v === "DONE" && (t.autoCreated || !canReviewTask(me, t)) && t.status !== "DONE"; const pending = incompleteSubtaskCount(t.id, tasks); const subtasksBlocked = ["REVIEW", "DONE"].includes(v) && pending > 0 && t.status !== v; return <option key={v} value={v} disabled={doneBlocked || subtasksBlocked || (v === "DONE" && doneLocked?.(t) && t.status !== "DONE")}>{l}{doneBlocked ? (t.autoCreated ? " (ticket approval required)" : " (review team approval required)") : subtasksBlocked ? ` (${pending} unfinished subtask${pending === 1 ? "" : "s"})` : v === "DONE" && doneLocked?.(t) && t.status !== "DONE" ? " (finish subtasks first)" : ""}</option>; })}
                    </select>
                  </div>
                  <b>{t.title}</b>
                  {t.ticket && <span className="chip-link" style={{ alignSelf: "flex-start" }}><Ticket size={13} /> From {t.ticket.key}</span>}
                  {t.parent && <span className="chip-link" style={{ alignSelf: "flex-start" }}>Subtask of {t.parent.title}</span>}
                  {t.teamAccesses?.length > 0 && <span className="chip-link" style={{ alignSelf: "flex-start" }}>Work team: {t.teamAccesses.filter((a) => a.accessRole !== "REVIEWER").map((a) => a.team?.name).filter(Boolean).join(", ") || "—"}</span>}
                  {t.teamAccesses?.some((a) => a.accessRole === "REVIEWER") && <span className="chip-link" style={{ alignSelf: "flex-start" }}>Review by: {t.teamAccesses.filter((a) => a.accessRole === "REVIEWER").map((a) => a.team?.name).filter(Boolean).join(", ")}</span>}
                  {incompleteSubtaskCount(t.id, tasks) > 0 && <small className="muted">{incompleteSubtaskCount(t.id, tasks)} unfinished subtask{incompleteSubtaskCount(t.id, tasks) === 1 ? "" : "s"}</small>}
                  <p>{t.description || "No description provided."}</p>
                  <div className="task-card-foot">
                    <span>{t.project?.name || t.organization?.name || "Workspace"}</span>
                    <AvatarStack users={(t.assignees || []).map((a) => a.user)} />
                    {t._count?.comments > 0 && <small title="Comments" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><MessageSquare size={12} />{t._count.comments}</small>}
                    {t._count?.attachments > 0 && <small title="Files" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Paperclip size={12} />{t._count.attachments}</small>}
                    <small className={isOverdue(t) ? "overdue" : ""}>{formatDate(t.dueDate)}</small>
                  </div>
                </article>
              ))}
            </div>
            {can(me, "task.create") && <button className="board-add" onClick={onCreate}><Plus size={15} /> Add task</button>}
          </section>
        );
      })}
    </div>
  );
}
