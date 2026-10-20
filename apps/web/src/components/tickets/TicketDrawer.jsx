import { useEffect, useState } from "react";
import { X, UploadCloud, ListChecks, Info, ThumbsUp, Undo2, Pencil, Check, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { pretty, formatDate } from "../../lib/formatters";
import { PriorityBadge, StatusBadge } from "../ui/StatusBadge";
import { can, ROLE_LABELS } from "../../lib/rbac";
import { assigneeGroups, isInTeams, sameIds } from "../../lib/teams";
import TeamMultiSelect from "../ui/TeamMultiSelect";
import TicketHistory from "./TicketHistory";

const STATUSES = ["OPEN", "TRIAGED", "IN_PROGRESS", "BLOCKED", "REVIEW", "CLIENT_REVIEW", "RESOLVED", "CLOSED"];
const CLIENT_LABEL = { OPEN: "Received", TRIAGED: "Reviewed by the team", IN_PROGRESS: "In progress", BLOCKED: "In progress", REVIEW: "In progress", CLIENT_REVIEW: "Waiting for your review", RESOLVED: "Done", CLOSED: "Closed" };
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export default function TicketDrawer({ ticket, comments, me, users = [], teams = [], onClose, onUpdate, onAddComment, onUpload }) {
  const [text, setText] = useState("");
  const [pasteHint, setPasteHint] = useState("");
  const handlePaste = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((it) => it.kind === "file" && (it.type.startsWith("image/") || it.type === "application/pdf"));
    if (!item) return;
    const file = item.getAsFile(); if (!file) return; e.preventDefault();
    const ext = file.type === "application/pdf" ? "pdf" : (file.type.split("/")[1] || "png");
    const pasted = new File([file], `pasted-attachment-${Date.now()}.${ext}`, { type: file.type });
    Promise.resolve(onUpload({ target: { files: [pasted], value: "" } }, ticket.id)).then(() => setPasteHint("Pasted attachment uploaded.")).catch(() => setPasteHint("Could not upload pasted attachment."));
  };
  const [tab, setTab] = useState("comments");
  const [visibility, setVisibility] = useState("CLIENT");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(ticket?.title || "");
  const [editDescription, setEditDescription] = useState(ticket?.description || "");
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [ownerTeamId, setOwnerTeamId] = useState("");
  const navigate = useNavigate();
  useEffect(() => { setEditTitle(ticket?.title || ""); setEditDescription(ticket?.description || ""); setEditing(false); setSelectedTeamIds((ticket?.teamAccesses || []).filter((a) => a.teamId !== ticket?.teamId).map((a) => a.teamId)); setOwnerTeamId(ticket?.teamId || ""); }, [ticket?.id, ticket?.title, ticket?.description, ticket?.teamId, ticket?.teamAccesses]);
  useEffect(() => { setTab("comments"); }, [ticket?.id]);
  if (!ticket) return null;

  const triage = can(me, "ticket.triage");
  const ownStatus = can(me, "ticket.update_own") && ticket.assigneeId === me.user.id;
  const requesterCanEdit = ticket.requesterId === me.user.id && (can(me, "ticket.update_own") || !me.isInternal);
  const canEditDetails = triage || requesterCanEdit;
  const canStatus = triage || ownStatus || (me.isInternal && requesterCanEdit);
  const task = ticket.tasks?.[0];
  const staff = me.isInternal;
  // Teams that are SAVED on the ticket decide who can be assigned. Unsaved changes in the pickers do not.
  const savedShared = (ticket.teamAccesses || []).filter((a) => a.teamId !== ticket.teamId).map((a) => a.teamId);
  const groups = assigneeGroups(teams, ticket.teamId, savedShared);
  const savedAccessIds = groups.map((g) => g.team.id);
  const legacyAssignee = ticket.assignee && ticket.teamId && !isInTeams(teams, savedAccessIds, ticket.assigneeId) ? ticket.assignee : null;
  const sharedNow = selectedTeamIds.filter((id) => id !== ownerTeamId);
  const teamsDirty = ownerTeamId !== (ticket.teamId || "") || !sameIds(sharedNow, savedShared);
  const canSaveTeams = teamsDirty && (ownerTeamId || !sharedNow.length);
  const saveTeams = async () => {
    // The assignee must belong to the saved teams, so clear them if they would no longer fit.
    const fits = ticket.assigneeId && ownerTeamId && isInTeams(teams, [ownerTeamId, ...sharedNow], ticket.assigneeId);
    await onUpdate(ticket.id, { teamId: ownerTeamId || null, teamIds: ownerTeamId ? sharedNow : [], ...(ticket.assigneeId && !fits ? { assigneeId: null } : {}) });
  };

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

        {/* STEP 1: teams (top). STEP 2: save. STEP 3: assignee, only from the saved teams. */}
        {staff && (triage ? (
          <div className="team-block">
            <div className="field">
              <label htmlFor="ticket-owner-team">Team</label>
              <select id="ticket-owner-team" value={ownerTeamId} onChange={(e) => setOwnerTeamId(e.target.value)} aria-label="Owning team">
                <option value="">Not routed — pick a team</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ticket-shared-teams">Also share with other teams (optional)</label>
              <TeamMultiSelect id="ticket-shared-teams" teams={teams} value={selectedTeamIds} onChange={setSelectedTeamIds} lockedId={ownerTeamId} disabled={!ownerTeamId} />
              {!ownerTeamId && <small className="hint">Choose the owning team first.</small>}
            </div>
            <button className="primary" disabled={!canSaveTeams} onClick={saveTeams}>Save team access</button>
            <div className="field">
              <label htmlFor="ticket-assignee">Assignee</label>
              <select id="ticket-assignee" value={ticket.assigneeId || ""} disabled={!ticket.teamId || teamsDirty} onChange={(e) => onUpdate(ticket.id, { assigneeId: e.target.value || null })} aria-label="Assignee">
                <option value="">{teamsDirty ? "Click “Save team access” first" : ticket.teamId ? "Unassigned" : "Select a team first"}</option>
                {legacyAssignee && <option value={legacyAssignee.id}>{legacyAssignee.name || legacyAssignee.email} (not in these teams — reassign)</option>}
                {groups.map((g) => (
                  <optgroup key={g.team.id} label={`${g.team.name}${g.owner ? " (owner team)" : " (shared)"}`}>
                    {g.people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </optgroup>
                ))}
              </select>
              <small className="hint">Only people from the saved team(s) can be assigned.</small>
            </div>
          </div>
        ) : (
          <>
            <div className="detail"><span>Team</span><b>{ticket.teamAccesses?.find((a) => a.teamId === ticket.teamId)?.team?.name || "Not routed yet"}</b></div>
            <div className="detail"><span>Assignee</span><b>{ticket.assignee?.name || ticket.assignee?.email || "Unassigned"}</b></div>
          </>
        ))}
        {!staff && <div className="detail"><span>Assignee</span><b>{ticket.assignee?.name || ticket.assignee?.email || "Unassigned"}</b></div>}

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
        {triage && <p className="hint"><Info size={13} style={{ verticalAlign: -2 }} /> Pick the team first, then assign someone from it. Assigning creates a task for that person automatically, and the two stay in sync.</p>}

        {staff && task && (
          <div className="linked-task">
            <ListChecks size={22} color="#5746e8" />
            <span><b>Linked task</b><small>Status: {pretty(task.status)} — updates move the ticket too</small></span>
            <button className="secondary" onClick={() => { onClose(); navigate("/tasks"); }}>Open</button>
          </div>
        )}

        <div className="drawer-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "comments"} className={tab === "comments" ? "tab on" : "tab"} onClick={() => setTab("comments")}>Comments ({comments.length})</button>
          <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "tab on" : "tab"} onClick={() => setTab("history")}>History</button>
        </div>
        {tab === "history" && <TicketHistory ticketId={ticket.id} showRoles={staff} refreshKey={`${ticket.updatedAt}|${ticket.status}|${ticket.assigneeId}|${ticket.teamId}|${comments.length}|${ticket._count?.attachments || 0}|${(ticket.teamAccesses || []).length}`} />}
        {tab === "comments" && comments.map((
          <div className="comment" key={c.id}>
            <b>{c.author?.name || c.author?.email}</b>
            <small>{pretty(c.visibility)} · {new Date(c.createdAt).toLocaleString()}</small>
            <p>{c.body}</p>
          </div>
        ))}
        {tab === "comments" && <form className="comment-form" onSubmit={post}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} onPaste={handlePaste} placeholder="Write a comment… (paste an image or PDF to attach)" rows={3} aria-label="Comment" />
          {pasteHint && <small className="hint">{pasteHint}</small>}
          <div className="row">
            {staff && <select value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Comment visibility"><option value="CLIENT">Visible to client</option><option value="INTERNAL">Internal note</option></select>}
            <button className="primary" disabled={!text.trim()}>Post comment</button>
          </div>
        </form>}

        {can(me, "file.upload") && (
          <>
            <div className="drawer-tabs"><b>Attachments</b></div>
            <label className="upload"><UploadCloud /><span>Upload an image or document, or paste an image/PDF into the comment box<input type="file" accept="image/*,.pdf,.doc,.docx,.txt" onChange={(e) => onUpload(e, ticket.id)} /></span></label>
          </>
        )}
      </aside>
    </>
  );
}
