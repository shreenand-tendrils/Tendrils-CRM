import { useEffect, useState } from "react";
import { api } from "../../api";
import { StatusBadge } from "../ui/StatusBadge";
import { describeEvent, actorLabel } from "../../lib/ticketHistory";
import { buildTree, mergeTimeline, taskPeople, taskTeams } from "../../lib/workThread";
import "../../styles/thread.css";

const DOT = { CREATED: "", TEAM: "team", TEAM_ACCESS: "team", ASSIGNEE: "assign", STATUS: "status", TASK_REVIEW: "status" };

function TaskNode({ node, focusTaskId, onOpenTask }) {
  const t = node.task;
  const { owner, shared } = taskTeams(t);
  const people = taskPeople(t);
  const focus = t.id === focusTaskId;
  const body = (
    <>
      <span className="thread-title">{t.title} <StatusBadge value={t.status} />{focus && <span className="here">You are here</span>}</span>
      <small>
        {t.parentId ? "Subtask" : "Task"}
        {owner ? ` · ${owner}${shared.length ? ` +${shared.join(", ")}` : ""}` : ""}
        {` · ${people.length ? people.join(", ") : "Unassigned"}`}
      </small>
    </>
  );
  return (
    <div className="task-node">
      {onOpenTask && !focus
        ? <button type="button" className="thread-card" onClick={() => onOpenTask(t)} aria-label={`Open task ${t.title}`}>{body}</button>
        : <div className={"thread-card" + (focus ? " focus" : "")}>{body}</div>}
      {node.children.length > 0 && (
        <div className="thread-branch">
          {node.children.map((c) => <div className="thread-item" key={c.task.id}><TaskNode node={c} focusTaskId={focusTaskId} onOpenTask={onOpenTask} /></div>)}
        </div>
      )}
    </div>
  );
}

// A git-graph style route: where the work came from, which teams it passed through, who holds it, and the tasks branching off it.
// Click a task to open it; click the ticket (from a task) to jump back to the ticket.
export default function WorkThread({ ticket, ticketId, currentTicket = false, tasks = [], focusTaskId, onOpenTask, onOpenTicket, refreshKey }) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    if (!ticketId) { setEvents([]); return undefined; }
    let live = true;
    api.get(`/tickets/${ticketId}/history`).then((r) => { if (live) setEvents(r.data || []); }).catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [ticketId, refreshKey]);

  const tree = buildTree(tasks.filter((t) => !t.autoCreated)); // the ticket's auto record is plumbing, not work
  const timeline = mergeTimeline(events, tree);
  const rootBody = ticket && (
    <>
      <span className="thread-title">{ticket.key} · {ticket.title} {ticket.status && <StatusBadge value={ticket.status} />}{currentTicket && <span className="here">You are here</span>}</span>
      <small>{[ticket.organization?.name, ticket.requester && `raised by ${ticket.requester.name || ticket.requester.email}`].filter(Boolean).join(" · ") || "Client request"}</small>
    </>
  );

  return (
    <div className="thread" aria-label="Work route">
      <div className="thread-legend">
        <span><i style={{ background: "#5746e8" }} />Ticket</span><span><i style={{ background: "#0f9d8a" }} />Team</span>
        <span><i style={{ background: "#e8872f" }} />Assignee</span><span><i style={{ background: "#e8462f", borderRadius: 3 }} />Task</span>
      </div>
      {ticket && (
        <div className="thread-item">
          <span className="thread-dot root" aria-hidden="true" />
          {onOpenTicket && !currentTicket
            ? <button type="button" className="thread-card" onClick={() => onOpenTicket(ticket)} aria-label={`Open ticket ${ticket.key}`}>{rootBody}</button>
            : <div className={"thread-card" + (currentTicket ? " focus" : "")}>{rootBody}</div>}
        </div>
      )}
      {timeline.map((item) => item.kind === "event" ? (
        <div className="thread-item" key={item.event.id}>
          <span className={`thread-dot ${DOT[item.event.type] || ""}`} aria-hidden="true" />
          <p className="thread-text"><b>{actorLabel(item.event, true)}</b> {describeEvent(item.event)}</p>
          <small>{new Date(item.event.createdAt).toLocaleString()}</small>
        </div>
      ) : (
        <div className="thread-item" key={item.node.task.id}>
          <span className="thread-dot task" aria-hidden="true" />
          <TaskNode node={item.node} focusTaskId={focusTaskId} onOpenTask={onOpenTask} />
        </div>
      ))}
      {!timeline.length && !ticket && <p className="hint">Nothing to show yet.</p>}
      {ticket && !tasks.filter((t) => !t.autoCreated).length && <p className="hint">No tasks yet. Use “Add linked task” to branch work off this ticket.</p>}
    </div>
  );
}
