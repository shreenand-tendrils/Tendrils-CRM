import { useEffect, useState } from "react";
import { X, UploadCloud, ListChecks, Info, ThumbsUp, Undo2, Pencil, Check, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { pretty, formatDate } from "../../lib/formatters";
import { PriorityBadge, StatusBadge } from "../ui/StatusBadge";
import { can } from "../../lib/rbac";

const STATUSES = ["OPEN", "TRIAGED", "IN_PROGRESS", "BLOCKED", "REVIEW", "CLIENT_REVIEW", "RESOLVED", "CLOSED"];
const CLIENT_LABEL = { OPEN: "Received", TRIAGED: "Reviewed by the team", IN_PROGRESS: "In progress", BLOCKED: "In progress", REVIEW: "In progress", CLIENT_REVIEW: "Waiting for your review", RESOLVED: "Done", CLOSED: "Closed" };
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export default function TicketDrawer({ ticket, comments, me, users = [], teams = [], onClose, onUpdate, onAddComment, onUpload }) {
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState("CLIENT");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(ticket?.title || "");
  const [editDescription, setEditDescription] = useState(ticket?.description || "");
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const navigate = useNavigate();
  useEffect(() => { setEditTitle(ticket?.title || ""); setEditDescription(ticket?.description || ""); setEditing(false); setSelectedTeamIds((ticket?.teamAccesses || []).filter((a) => a.teamId !== ticket?.teamId).map((a) => a.teamId)); }, [ticket?.id, ticket?.title, ticket?.description, ticket?.teamId, ticket?.teamAccesses]);
  if (!ticket) return null;

  const triage = can(me, "ticket.triage");
  const ownStatus = can(me, "ticket.update_own") && ticket.assigneeId === me.user.id;
  const requesterCanEdit = ticket.requesterId === me.user.id && (can(me, "ticket.update_own") || !me.isInternal);
  const canEditDetails = triage || requesterCanEdit;
  const canStatus = triage || ownStatus || (me.isInternal && requesterCanEdit);
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
        {editing ? (
          <div className="field">
            <label htmlFor="ticket-edit-title">Ticket title</label>
            <input id="ticket-edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={220} />
            <label htmlFor="ticket-edit-description">Description</label>
            <textarea id="ticket-edit-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} />
            <div className="row"><button className="primary" disabled={!editTitle.trim()} onClick={async () => { const saved = await onUpdate(ticket.id, { title: editTitle.trim(), description: editDescription }); if (saved) setEditing(false); }}><Check size={14} /> Save details</button><button className="secondary" onClick={() => { setEditTitle(ticket.title); setEditDescription(ticket.description || ""); setEditing(false); }}><XCircle size={14} /> Cancel</button></div>
          </div>
        ) : <><div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h2>{ticket.title}</h2>{canEditDetails && <button className="secondary" onClick={() => setEditing(true)} aria-label="Edit ticket details"><Pencil size={14} /> Edit</button>}</div><p>{ticket.description || "No description added."}</p></>}

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
        {triage && teams.length > 0 && (
          <div className="field">
            <label htmlFor="ticket-participating-teams">Participating teams (only selected teams can see this ticket)</label>
            <select id="ticket-participating-teams" multiple size={Math.min(4, Math.max(2, teams.length))} value={selectedTeamIds} onChange={(e) => setSelectedTeamIds(Array.from(e.target.selectedOptions, (o) => o.value))}>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.id === ticket.teamId ? " (owner)" : ""}</option>)}
            </select>
            <button className="secondary" onClick={async () => { const saved = await onUpdate(ticket.id, { teamIds: selectedTeamIds }); if (saved) setSelectedTeamIds(selectedTeamIds); }}>Save team access</button>
          </div>
        )}
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
