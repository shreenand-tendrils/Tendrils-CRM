import { useMemo, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import Panel from "../components/ui/Panel";
import TaskBoard from "../components/tasks/TaskBoard";
import AvatarStack from "../components/ui/AvatarStack";
import { PriorityBadge, StatusBadge } from "../components/ui/StatusBadge";
import { formatDate, isOverdue } from "../lib/formatters";
import { useAppStore } from "../store";

export default function TasksPage({ data, onCreate, onStatusChange, onOpen, doneLocked }) {
  const { search } = useAppStore();
  const [layout, setLayout] = useState("board");
  const [mine, setMine] = useState(false);
  const [priority, setPriority] = useState("");
  const [project, setProject] = useState("");
  const meId = data.me?.user?.id;

  const tasks = useMemo(() => (data.tasks || []).filter((t) => {
    if (mine && !(t.assignees || []).some((a) => a.user.id === meId) && t.assigneeId !== meId) return false;
    if (priority && t.priority !== priority) return false;
    if (project && t.projectId !== project) return false;
    return !search || `${t.title} ${t.project?.name || ""} ${t.organization?.name || ""}`.toLowerCase().includes(search.toLowerCase());
  }), [data.tasks, mine, priority, project, search, meId]);

  const toolbar = (
    <div className="toolbar">
      <div className="seg">
        <button className={layout === "board" ? "on" : ""} onClick={() => setLayout("board")}><LayoutGrid size={13} /> Board</button>
        <button className={layout === "list" ? "on" : ""} onClick={() => setLayout("list")}><List size={13} /> List</button>
      </div>
      <button className={"chip" + (mine ? " on" : "")} onClick={() => setMine(!mine)}>My tasks</button>
      <select value={priority} onChange={(e) => setPriority(e.target.value)}>
        <option value="">All priorities</option>
        {["URGENT", "HIGH", "MEDIUM", "LOW"].map((p) => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}
      </select>
      <select value={project} onChange={(e) => setProject(e.target.value)}>
        <option value="">All projects</option>
        {(data.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <small className="muted">{tasks.length} tasks</small>
    </div>
  );

  return (
    <Panel title="Tasks" sub="Tasks created from assigned tickets appear here automatically">
      {toolbar}
      {layout === "board" ? (
        <TaskBoard tasks={tasks} me={data.me} onCreate={onCreate} onStatusChange={onStatusChange} onOpen={onOpen} doneLocked={doneLocked} />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Task</th><th>Project</th><th>Status</th><th>Priority</th><th>Assignees</th><th>Due</th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} onClick={() => onOpen?.(t)} style={onOpen ? { cursor: "pointer" } : undefined}>
                  <td data-label="Task"><b>{t.title}</b>{t.ticket && <div><span className="chip-link">From {t.ticket.key}</span></div>}</td>
                  <td data-label="Project">{t.project?.name || t.organization?.name || "—"}</td>
                  <td data-label="Status"><StatusBadge value={t.status} /></td>
                  <td data-label="Priority"><PriorityBadge value={t.priority} /></td>
                  <td data-label="Assignees"><AvatarStack users={(t.assignees || []).map((a) => a.user)} /></td>
                  <td data-label="Due" className={isOverdue(t) ? "overdue" : ""}>{formatDate(t.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
