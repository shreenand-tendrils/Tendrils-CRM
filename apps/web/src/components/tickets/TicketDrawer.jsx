import { useEffect, useState } from "react";
import { Trash2, UploadCloud, ListChecks, Info, ThumbsUp, Undo2, Pencil, Check, XCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { pretty, formatDate } from "../../lib/formatters";
import { PriorityBadge, StatusBadge } from "../ui/StatusBadge";
import { can, ROLE_LABELS } from "../../lib/rbac";
import { assigneeGroups, isInTeams, sameIds } from "../../lib/teams";
import TeamMultiSelect from "../ui/TeamMultiSelect";
import TicketHistory from "./TicketHistory";
import TicketAttachments from "./TicketAttachments";
import TicketReminder from "./TicketReminder";
import Window from "../ui/Window";
import { clipboardFiles, appendLine, PASTE_MARK } from "../../lib/paste";
import WorkThread from "../work/WorkThread";
import { collectThread, buildTree, taskPeople } from "../../lib/workThread";

const STATUSES = ["OPEN", "TRIAGED", "IN_PROGRESS", "BLOCKED", "REVIEW", "CLIENT_REVIEW", "RESOLVED", "CLOSED"];
const CLIENT_LABEL = { OPEN: "Open", TRIAGED: "In Progress", IN_PROGRESS: "In Progress", BLOCKED: "Need more Info", REVIEW: "Review/Test", CLIENT_REVIEW: "Review/Help", RESOLVED: "Resolved", CLOSED: "Closed" };
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUS_LABELS = { OPEN: "Open", TRIAGED: "In Progress", IN_PROGRESS: "Open - QA", BLOCKED: "Need more Info", REVIEW: "Review/Test", CLIENT_REVIEW: "Review/Help", RESOLVED: "Resolved", CLOSED: "Closed" };

export default function TicketDrawer({ ticket, comments, me, users = [], teams = [], tasks = [], onClose, onUpdate, onAddComment, onUpload, onAddTask, onOpenTask, onDelete }) {
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
  const [tab, setTab] = useState(me?.isInternal ? "route" : "comments");
  const [visibility, setVisibility] = useState("CLIENT");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(ticket?.title || "");
  const [editDescription, setEditDescription] = useState(ticket?.description || "");
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [ownerTeamId, setOwnerTeamId] = useState("");
  const navigate = useNavigate();
  useEffect(() => { setEditTitle(ticket?.title || ""); setEditDescription(ticket?.description || ""); setEditing(false); setSelectedTeamIds((ticket?.teamAccesses || []).filter((a) => a.teamId !== ticket?.teamId).map((a) => a.teamId)); setOwnerTeamId(ticket?.teamId || ""); }, [ticket?.id, ticket?.title, ticket?.description, ticket?.teamId, ticket?.teamAccesses]);
  useEffect(() => { setTab(me?.isInternal ? "route" : "comments"); }, [ticket?.id, me?.isInternal]);
  if (!ticket) return null;

  const triage = can(me, "ticket.triage");
  const ownStatus = can(me, "ticket.update_own") && ticket.assigneeId === me.user.id;
  const requesterCanEdit = ticket.requesterId === me.user.id && (can(me, "ticket.update_own") || !me.isInternal);
  const canEditDetails = triage || requesterCanEdit;
  const canStatus = triage || ownStatus || (me.isInternal && requesterCanEdit);
  const clientRaised = ticket.visibility === "CLIENT" && ticket.employeeReview === true;
  const reviewLocked = staff && clientRaised; // client-originated work must be reviewed by the client before closure
  // Managers/admins can delete any ticket; whoever raised it can delete it while it is still Open, unassigned and unanswered (server re-checks).
  const canDelete = can(me, "ticket.delete") || (ticket.requesterId === me.user?.id && ticket.status === "OPEN" && !ticket.assigneeId && !(ticket._count?.comments > 0));
  const staff = me.isInternal;
  const linked = staff ? tasks.filter((t) => t.ticketId === ticket.id) : (ticket.tasks || []);
  const linkedRoots = buildTree(collectThread(tasks, { ticketId: ticket.id })).map((n) => n.task);
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

  const clientReview = !staff && ticket.status === "CLIENT_REVIEW" && (
    <div className="linked-task">
      <ThumbsUp size={22} color="#5746e8" />
      <span><b>Ready for your review</b><small>Approve it, or send it back with a comment explaining what to change.</small></span>
      <button className="primary" onClick={() => onUpdate(ticket.id, { status: "CLOSED" })}>Approve</button>
      <button className="secondary" onClick={() => onUpdate(ticket.id, { status: "IN_PROGRESS" })}><Undo2 size={14} /> Send back</button>
    </div>
  );

  const teamBlock = staff && (triage ? (
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
    <div className="win-card">
      <div className="detail"><span>Team</span><b>{ticket.teamAccesses?.find((a) => a.teamId === ticket.teamId)?.team?.name || "Not routed yet"}</b></div>
      <div className="detail"><span>Assignee</span><b>{ticket.assignee?.name || ticket.assignee?.email || "Unassigned"}</b></div>
    </div>
  ));

  const side = (
    <>
      {teamBlock}
      <div className="win-card">
        {!staff && <div className="detail"><span>Assignee</span><b>{ticket.assignee?.name || ticket.assignee?.email || "Unassigned"}</b></div>}
        <div className="detail"><span>Client</span><b>{ticket.organization?.name}</b></div>
        <div className="detail"><span>Due</span><b>{formatDate(ticket.dueDate)}</b></div>
        <div className="detail"><span>Status</span>
          {canStatus
            ? <select className="table-select" value={ticket.status} onChange={(e) => onUpdate(ticket.id, { status: e.target.value })} aria-label="Status">{STATUSES.map((s) => { const locked = reviewLocked && s === "CLOSED"; return <option key={s} value={s} disabled={locked}>{s === "CLIENT_REVIEW" ? "Review/Help" : pretty(s)}</option>; })}</select>
            : staff ? <StatusBadge value={ticket.status} /> : <b>{CLIENT_LABEL[ticket.status] || pretty(ticket.status)}</b>}
        </div>
        <div className="detail"><span>Priority</span>
          {triage
            ? <select className="table-select" value={ticket.priority} onChange={(e) => onUpdate(ticket.id, { priority: e.target.value })} aria-label="Priority">{PRIORITIES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</select>
            : <PriorityBadge value={ticket.priority} />}
        </div>
      </div>
      {canDelete && onDelete && (
        <button type="button" className="secondary" style={{ color: "#c0262d", borderColor: "#f0c4c7" }}
          onClick={() => { if (window.confirm(`Delete ${ticket.key}? Its comments, files and history are removed and this cannot be undone.`)) onDelete(ticket); }}>
          <Trash2 size={14} /> Delete ticket
        </button>
      )}
      {triage && <p className="hint"><Info size={13} style={{ verticalAlign: -2 }} /> Pick the team first, then assign someone from it. Assigning creates a task for that person automatically, and the two stay in sync.</p>}
      {staff && <TicketReminder ticket={ticket} />}
      {staff && (
        <div className="linked-task" style={{ flexWrap: "wrap" }}>
          <ListChecks size={22} color="#5746e8" />
          <span><b>Linked tasks ({linked.length})</b><small>{ticket.teamId ? "Branch work off this ticket, for your team or another one." : "Route the ticket to a team before adding tasks."}</small></span>
          {can(me, "task.create") && <button className="primary" disabled={!ticket.teamId} onClick={() => onAddTask?.(ticket)}><Plus size={14} /> Add linked task</button>}
          {linkedRoots.length > 0 && (
            <div className="linked-rows">
              {linkedRoots.map((t) => (
                <button key={t.id} type="button" onClick={() => onOpenTask?.(t)} aria-label={`Open task ${t.title}`}>
                  <span><b>{t.title}</b><small style={{ display: "block" }}>{t.autoCreated ? "Auto task" : "Linked task"} · {taskPeople(t).join(", ") || "Unassigned"}</small></span>
                  <StatusBadge value={t.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <Window
      label={`Ticket ${ticket.key}`} onClose={onClose} side={side}
      head={<><b className="win-key">{ticket.key}</b>{staff ? <StatusBadge value={ticket.status} /> : <b>{CLIENT_LABEL[ticket.status] || pretty(ticket.status)}</b>}<PriorityBadge value={ticket.priority} /></>}
    >
      {clientReview}
      {editing ? (
        <div className="field">
          <label htmlFor="ticket-edit-title">Ticket title</label>
          <input id="ticket-edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={220} />
          <label htmlFor="ticket-edit-description">Description</label>
          <textarea id="ticket-edit-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} placeholder="Describe the request here" />
          <div className="row"><button className="primary" disabled={!editTitle.trim()} onClick={async () => { const saved = await onUpdate(ticket.id, { title: editTitle.trim(), description: editDescription }); if (saved) setEditing(false); }}><Check size={14} /> Save details</button><button className="secondary" onClick={() => { setEditTitle(ticket.title); setEditDescription(ticket.description || ""); setEditing(false); }}><XCircle size={14} /> Cancel</button></div>
        </div>
      ) : (
        <div>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h2>{ticket.title}</h2>{canEditDetails && <button className="secondary" onClick={() => setEditing(true)} aria-label="Edit ticket details"><Pencil size={14} /> Edit</button>}</div>
          <p style={{ marginTop: 6 }}>{ticket.description || "No description added."}</p>
        </div>
      )}

      {!staff && linked.length > 0 && <div className="win-card"><h3>Tasks for this ticket</h3>{linked.map((t) => <div key={t.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line, #e5e7eb)" }}><div className="detail"><span>{t.title}</span><b>{CLIENT_LABEL[t.status] || pretty(t.status)}</b></div>{t.description && <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 8px" }}>{t.description}</p>}<small className="muted">Created {formatDate(t.createdAt)} · Due {formatDate(t.dueDate)}</small>{(t.subtasks || []).map((st) => <div key={st.id} style={{ margin: "8px 0 0 12px", paddingLeft: 10, borderLeft: "2px solid #ddd" }}><b>{st.title}</b><small style={{ display: "block" }}>{CLIENT_LABEL[st.status] || pretty(st.status)} · Created {formatDate(st.createdAt)} · Due {formatDate(st.dueDate)}</small>{st.description && <p style={{ whiteSpace: "pre-wrap" }}>{st.description}</p>}</div>)}</div>)}</div>}
      <div className="drawer-tabs" role="tablist">
        {staff && <button role="tab" aria-selected={tab === "route"} className={tab === "route" ? "tab on" : "tab"} onClick={() => setTab("route")}>Route</button>}
        <button role="tab" aria-selected={tab === "comments"} className={tab === "comments" ? "tab on" : "tab"} onClick={() => setTab("comments")}>Comments ({comments.length})</button>
        <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "tab on" : "tab"} onClick={() => setTab("history")}>History</button>
        {can(me, "file.upload") && <button role="tab" aria-selected={tab === "files"} className={tab === "files" ? "tab on" : "tab"} onClick={() => setTab("files")}>Files ({ticket._count?.attachments || 0})</button>}
      </div>
      {staff && tab === "route" && <WorkThread ticket={ticket} ticketId={ticket.id} currentTicket tasks={collectThread(tasks, { ticketId: ticket.id })} onOpenTask={onOpenTask} refreshKey={`${ticket.updatedAt}|${ticket.status}|${ticket.assigneeId}|${ticket.teamId}|${linked.length}|${(ticket.teamAccesses || []).length}`} />}
      {tab === "history" && <TicketHistory ticketId={ticket.id} showRoles={staff} refreshKey={`${ticket.updatedAt}|${ticket.status}|${ticket.assigneeId}|${ticket.teamId}|${comments.length}|${ticket._count?.attachments || 0}|${(ticket.teamAccesses || []).length}`} />}
      {tab === "comments" && comments.map((c) => (
        <div className="comment" key={c.id}>
          <b>{c.author?.name || c.author?.email}</b>
          <small>{pretty(c.visibility)} · {new Date(c.createdAt).toLocaleString()}</small>
          <p>{c.body}</p>
        </div>
      ))}
      {tab === "comments" && <form className="comment-form" onSubmit={post}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onPaste={handlePaste} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) post(e); }} placeholder="Write a comment… (Ctrl+Enter to send, paste an image or PDF to attach)" rows={3} aria-label="Comment" />
        {pasteHint && <small className="hint">{pasteHint}</small>}
        <div className="row">
          {staff && <select value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Comment visibility"><option value="CLIENT">Visible to client</option><option value="INTERNAL">Internal note</option></select>}
          <button className="primary" disabled={!text.trim()}>Post comment</button>
        </div>
      </form>}
      {tab === "files" && can(me, "file.upload") && (
        <>
          <label className="upload"><UploadCloud /><span>Upload an image or document, or paste an image/PDF into the comment box<input type="file" accept="image/*,.pdf,.doc,.docx,.txt" onChange={(e) => onUpload(e, ticket.id)} /></span></label>
          <TicketAttachments ticketId={ticket.id} refreshKey={ticket._count?.attachments || 0} />
        </>
      )}
    </Window>
  );
}
