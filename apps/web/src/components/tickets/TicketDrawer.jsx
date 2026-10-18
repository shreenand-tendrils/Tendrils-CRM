import { useState } from "react";
import { X, UploadCloud, ListChecks, Info, ThumbsUp, Undo2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { pretty, formatDate } from "../../lib/formatters";
import { PriorityBadge, StatusBadge } from "../ui/StatusBadge";
import { can } from "../../lib/rbac";

const STATUSES = ["OPEN", "TRIAGED", "IN_PROGRESS", "BLOCKED", "REVIEW", "CLIENT_REVIEW", "RESOLVED", "CLOSED"];
const CLIENT_LABEL = { OPEN: "Received", TRIAGED: "Reviewed by the team", IN_PROGRESS: "In progress", BLOCKED: "In progress", REVIEW: "In progress", CLIENT_REVIEW: "Waiting for your review", RESOLVED: "Done", CLOSED: "Closed" };
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export default function TicketDrawer({ ticket, comments, me, users = [], onClose, onUpdate, onAddComment, onUpload }) {
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState("CLIENT");
  const navigate = useNavigate();
  if (!ticket) return null;

  const triage = can(me, "ticket.triage");
  const ownStatus = can(me, "ticket.update_own") && ticket.assigneeId === me.user.id;
  const canStatus = triage || ownStatus;
  const task = ticket.tasks?.[0];
  const staff = me.isInternal;

  const post = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await onAddComment(text.trim(), staff ? visibility : "CLIENT");
    setText("");
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Ticket ${ticket.key}`}>
        <div className="drawer-head"><b>{ticket.key}</b><button onClick={onClose} aria-label="Close"><X /></button></div>
        <h2>{ticket.title}</h2>
        <p>{ticket.description || "No description added."}</p>

        <div className="detail"><span>Client</span><b>{ticket.organization?.name}</b></div>
        <div className="detail"><span>Due</span><b>{formatDate(ticket.dueDate)}</b></div>

        <div className="detail"><span>Status</span>
          {canStatus
            ? <select className="table-select" value={ticket.status} onChange={(e) => onUpdate(ticket.id, { status: e.target.value })} aria-label="Status">{STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select>
            : staff ? <StatusBadge value={ticket.status} /> : <b>{CLIENT_LABEL[ticket.status] || pretty(ticket.status)}</b>}
        </div>
        {!staff && ticket.status === "CLIENT_REVIEW" && (
          <div className="linked-task">
            <ThumbsUp size={22} color="#5746e8" />
            <span><b>Ready for your review</b><small>Approve it, or send it back with a comment explaining what to change.</small></span>
            <button className="primary" onClick={() => onUpdate(ticket.id, { status: "CLOSED" })}>Approve</button>
            <button className="secondary" onClick={() => onUpdate(ticket.id, { status: "IN_PROGRESS" })}><Undo2 size={14} /> Send back</button>
          </div>
        )}
        <div className="detail"><span>Priority</span>
          {triage
            ? <select className="table-select" value={ticket.priority} onChange={(e) => onUpdate(ticket.id, { priority: e.target.value })} aria-label="Priority">{PRIORITIES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</select>
            : <PriorityBadge value={ticket.priority} />}
        </div>
        <div className="detail"><span>Assignee</span>
          {triage
            ? <select className="table-select" value={ticket.assigneeId || ""} onChange={(e) => onUpdate(ticket.id, { assigneeId: e.target.value || null })} aria-label="Assignee"><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select>
            : <b>{ticket.assignee?.name || ticket.assignee?.email || "Unassigned"}</b>}
        </div>
        {triage && <p className="hint"><Info size={13} style={{ verticalAlign: -2 }} /> Assigning a ticket creates a task for that person automatically, and the two stay in sync.</p>}

        {staff && task && (
          <div className="linked-task">
            <ListChecks size={22} color="#5746e8" />
            <span><b>Linked task</b><small>Status: {pretty(task.status)} — updates move the ticket too</small></span>
            <button className="secondary" onClick={() => { onClose(); navigate("/tasks"); }}>Open</button>
          </div>
        )}

        <div className="drawer-tabs"><b>Comments ({comments.length})</b></div>
        {comments.map((c) => (
          <div className="comment" key={c.id}>
            <b>{c.author?.name || c.author?.email}</b>
            <small>{pretty(c.visibility)} · {new Date(c.createdAt).toLocaleString()}</small>
            <p>{c.body}</p>
          </div>
        ))}
        <form className="comment-form" onSubmit={post}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment…" rows={3} aria-label="Comment" />
          <div className="row">
            {staff && <select value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Comment visibility"><option value="CLIENT">Visible to client</option><option value="INTERNAL">Internal note</option></select>}
            <button className="primary" disabled={!text.trim()}>Post comment</button>
          </div>
        </form>

        {can(me, "file.upload") && (
          <>
            <div className="drawer-tabs"><b>Attachments</b></div>
            <label className="upload"><UploadCloud /><span>Upload an image or document<input type="file" onChange={(e) => onUpload(e, ticket.id)} /></span></label>
          </>
        )}
      </aside>
    </>
  );
}
