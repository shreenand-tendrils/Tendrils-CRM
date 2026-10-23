import { Plus, Ticket, MessageSquare, Paperclip, ListChecks, ShieldCheck } from "lucide-react";
import { formatDate, isOverdue } from "../../lib/formatters";
import AvatarStack from "../ui/AvatarStack";
import { PriorityBadge } from "../ui/StatusBadge";
import { can } from "../../lib/rbac";
import { incompleteSubtaskCount, subtaskStats } from "../../lib/workThread";
import { statusChoices, statusRights, REVIEW_LABEL } from "../../lib/taskReview";
import { Lock } from "lucide-react";
import "../../styles/workflow.css";

export const COLUMNS = [["BACKLOG", "Backlog"], ["TODO", "To do"], ["IN_PROGRESS", "In progress"], ["BLOCKED", "Blocked"], ["REVIEW", "In review"], ["DONE", "Done"]];

const reviewChip = (task, authority) => {
  if (task.status !== "REVIEW") return null;
  if (authority === "CLIENT") return "Waiting for client";
  if (authority === "TEAM") return `Review by ${(task.teamAccesses || []).filter((a) => a.accessRole === "REVIEWER").map((a) => a.team?.name).filter(Boolean).join(", ") || "requesting team"}`;
  if (authority === "PEER") return "Waiting for a teammate";
  return null;
};

// Board of TOP-LEVEL work. Subtasks live inside their task (checklist), and the ticket's auto record is never shown.
export default function TaskBoard({ tasks = [], allTasks, me, onStatusChange, onCreate, onOpen }) {
  const universe = allTasks || tasks;
  return (
    <div className="task-board">
      {COLUMNS.map(([key, label]) => {
        const list = tasks.filter((t) => t.status === key);
        return (
          <section className="task-column" key={key} aria-label={label}>
            <header><span>{label}</span><b>{list.length}</b></header>
            <div className="task-cards">
              {list.map((t) => {
                const parent = t.parentId ? universe.find((x) => x.id === t.parentId) : null;
                const parentIds = parent ? [parent.assigneeId, ...(parent.assignees || []).map((a) => a.user?.id)].filter(Boolean) : [];
                const rights = statusRights(me, t, parentIds);
                const { authority } = rights;
                const subs = subtaskStats(t.id, universe);
                const pending = incompleteSubtaskCount(t.id, universe);
                const choices = statusChoices({ me, task: t, pendingSubtasks: pending, columns: COLUMNS, parentAssigneeIds: parentIds });
                const waiting = reviewChip(t, authority);
                const reviewers = (t.teamAccesses || []).filter((a) => a.accessRole === "REVIEWER");
                return (
                  <article className="task-card" key={t.id} style={onOpen ? { cursor: "pointer" } : undefined} tabIndex={onOpen ? 0 : undefined} role={onOpen ? "button" : undefined} aria-label={onOpen ? `Open task ${t.title}` : undefined} onClick={() => onOpen?.(t)} onKeyDown={(e) => { if (onOpen && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(t); } }}>
                    <div className="task-card-top">
                      <PriorityBadge value={t.priority} />
                      <select aria-label="Change task status" onClick={(e) => e.stopPropagation()} value={t.status} disabled={!rights.any} title={!rights.any ? "Only the people this task is assigned to can change its status" : undefined} onChange={(e) => onStatusChange?.(t, e.target.value)}>
                        {choices.map((c) => <option key={c.value} value={c.value} disabled={c.disabled}>{c.label}{c.why ? ` (${c.why})` : ""}</option>)}
                      </select>
                    </div>
                    <b>{t.title}</b>
                    <div className="task-meta">
                      {t.ticket && <span className="chip-link"><Ticket size={13} /> {t.ticket.key}</span>}
                      {authority !== "NONE" && authority !== "TICKET" && <span className="chip-link soft" title={REVIEW_LABEL[authority]}><ShieldCheck size={13} /> {REVIEW_LABEL[authority]}</span>}
                      {reviewers.length > 0 && authority === "TEAM" && <span className="chip-link soft">From {reviewers.map((a) => a.team?.name).filter(Boolean).join(", ")}</span>}
                      {subs.total > 0 && <span className={"chip-link" + (subs.done === subs.total ? " ok" : "")}><ListChecks size={13} /> {subs.done}/{subs.total} subtasks</span>}
                    </div>
                    {waiting && <div className="task-wait" role="status">{waiting}</div>}
                    <div className="task-card-foot">
                      <span>{t.project?.name || t.organization?.name || "Workspace"}</span>
                      <AvatarStack users={(t.assignees || []).map((a) => a.user)} />
                      {t._count?.comments > 0 && <small title="Comments" className="icon-count"><MessageSquare size={12} />{t._count.comments}</small>}
                      {t._count?.attachments > 0 && <small title="Files" className="icon-count"><Paperclip size={12} />{t._count.attachments}</small>}
                      <small className={isOverdue(t) ? "overdue" : ""}>{formatDate(t.dueDate)}</small>
                    </div>
                  </article>
                );
              })}
            </div>
            {can(me, "task.create") && <button className="board-add" onClick={onCreate}><Plus size={15} /> Add task</button>}
          </section>
        );
      })}
    </div>
  );
}
