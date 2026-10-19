import { Plus, Ticket } from "lucide-react";
import { formatDate, isOverdue } from "../../lib/formatters";
import AvatarStack from "../ui/AvatarStack";
import { PriorityBadge } from "../ui/StatusBadge";
import { can, canEditTask } from "../../lib/rbac";

export const COLUMNS = [["BACKLOG", "Backlog"], ["TODO", "To do"], ["IN_PROGRESS", "In progress"], ["BLOCKED", "Blocked"], ["REVIEW", "Review"], ["DONE", "Done"]];

export default function TaskBoard({ tasks = [], me, onStatusChange, onCreate }) {
  return (
    <div className="task-board">
      {COLUMNS.map(([key, label]) => {
        const list = tasks.filter((t) => t.status === key);
        return (
          <section className="task-column" key={key} aria-label={label}>
            <header><span>{label}</span><b>{list.length}</b></header>
            <div className="task-cards">
              {list.map((t) => (
                <article className="task-card" key={t.id}>
                  <div className="task-card-top">
                    <PriorityBadge value={t.priority} />
                    <select aria-label="Change task status" value={t.status} disabled={!canEditTask(me, t)} title={canEditTask(me, t) ? undefined : "You can only move tasks assigned to you"} onChange={(e) => onStatusChange(t, e.target.value)}>
                      {COLUMNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <b>{t.title}</b>
                  {t.ticket && <span className="chip-link" style={{ alignSelf: "flex-start" }}><Ticket size={13} /> From {t.ticket.key}</span>}
                  {t.parent && <span className="chip-link" style={{ alignSelf: "flex-start" }}>Subtask of {t.parent.title}</span>}
                  {t.teamAccesses?.length > 0 && <span className="chip-link" style={{ alignSelf: "flex-start" }}>Teams: {t.teamAccesses.map((a) => a.team?.name).filter(Boolean).join(", ")}</span>}
                  <p>{t.description || "No description provided."}</p>
                  <div className="task-card-foot">
                    <span>{t.project?.name || t.organization?.name || "Workspace"}</span>
                    <AvatarStack users={(t.assignees || []).map((a) => a.user)} />
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
