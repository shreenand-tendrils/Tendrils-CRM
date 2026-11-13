import { useEffect, useState } from "react";
import { Paperclip, Trash2, Info, ThumbsUp, Undo2, Pencil, Check, XCircle, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { pretty, formatDate } from "../../lib/formatters";
import { PriorityBadge, StatusBadge, TicketStatusBadge } from "../ui/StatusBadge";
import { can, ROLE_LABELS } from "../../lib/rbac";
import { assigneeGroups, isInTeams, sameIds, peopleOfTeams, ticketTeamLabel } from "../../lib/teams";
import PeoplePicker from "../ui/PeoplePicker";
import TeamMultiSelect from "../ui/TeamMultiSelect";
import TicketHistory from "./TicketHistory";
import TicketReminder from "./TicketReminder";
import Window from "../ui/Window";
import PasteTextarea from "../ui/PasteTextarea";
import RichText from "../ui/RichText";
import TicketTasks from "./TicketTasks";
import { STATUSES, STATUS_LABEL, PROGRESS_FOR, PROGRESS_LABEL, clientStatusText, daysPassed, dayLabel } from "../../lib/ticketStatus";
import Discussion from "../work/Discussion";
import ActivityTab from "../work/ActivityTab";
import { collectThread, buildTree, taskPeople } from "../../lib/workThread";
import Linkify from "../ui/Linkify";
import Avatar from "../ui/Avatar";
import CopyLinkButton from "./CopyLinkButton";
import "../../styles/ticket-view.css";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

// One labelled line in the side panel: label on the left, value or control on the right.
const Row = ({ label, htmlFor, children, stack = false }) => (
  <div className={`tv-row${stack ? " stack" : ""}`}>
    <label htmlFor={htmlFor}>{label}</label>
    <div className="v">{children}</div>
  </div>
);

// Where the ticket is in its life: Open, then Review (test or help), then Closed.
function Steps({ ticket, staff }) {
  const at = ticket.status === "CLOSED" ? 2 : ticket.status === "OPEN" ? 0 : 1;
  const steps = [
    { label: "Open", sub: staff ? (ticket.progress && ticket.status === "OPEN" ? PROGRESS_LABEL[ticket.progress] : "") : (at === 0 ? clientStatusText(ticket) : "") },
    ticket.status === "REVIEW_HELP"
      ? { label: "Needs info", sub: staff ? "" : clientStatusText(ticket) }
      : { label: "Review", sub: at === 1 ? (staff ? "Test / resolved" : clientStatusText(ticket)) : "" },
    { label: "Closed", sub: "" },
  ];
  return (
    <ol className="tv-steps" aria-label="Ticket progress">
      {steps.map((st, i) => (
        <li key={st.label} className={`tv-step${i < at ? " done" : i === at ? " now" : ""}${i === at && ticket.status === "REVIEW_HELP" ? " help" : ""}`} aria-current={i === at ? "step" : undefined}>
          <b>{st.label}</b>{st.sub && <small>{st.sub}</small>}
        </li>
      ))}
    </ol>
  );
}

export default function TicketDrawer({ ticket, comments, me, users = [], teams = [], tasks = [], onClose, onUpdate, onAddComment, onUpload, onAddTask, onOpenTask, onDelete, onRefresh, notify }) {
  const [pasteHint, setPasteHint] = useState("");
  const [tab, setTab] = useState(ticket?.tasksInReview > 0 && !me?.isInternal ? "tasks" : "comments");
  const [disc, setDisc] = useState(null); // live counts reported by the Comments & files tab
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(ticket?.title || "");
  const [editDescription, setEditDescription] = useState(ticket?.description || "");
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [ownerTeamId, setOwnerTeamId] = useState("");
  const navigate = useNavigate();
  const [collabIds, setCollabIds] = useState([]);
  useEffect(() => { setCollabIds((ticket?.collaborators || []).map((c) => c.userId)); }, [ticket?.id, ticket?.collaborators]);
  useEffect(() => { setEditTitle(ticket?.title || ""); setEditDescription(ticket?.description || ""); setEditing(false); setSelectedTeamIds((ticket?.teamAccesses || []).filter((a) => a.teamId !== ticket?.teamId).map((a) => a.teamId)); setOwnerTeamId(ticket?.teamId || ""); }, [ticket?.id, ticket?.title, ticket?.description, ticket?.teamId, ticket?.teamAccesses]);
  useEffect(() => { setTab(ticket?.tasksInReview > 0 && !me?.isInternal ? "tasks" : "comments"); setDisc(null); }, [ticket?.id, me?.isInternal]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ticket) return null;

  const triage = can(me, "ticket.triage");
  const canRoute = triage || (can(me, "ticket.route") && (ticket.teamAccesses || []).some((a) => { const team = teams.find((t) => t.id === a.teamId); return (team?.members || []).some((m) => m.membership?.user?.id === me.user?.id); }));
  const iCollaborate = (ticket.collaborators || []).some((c) => c.userId === me.user.id);
  const ownStatus = can(me, "ticket.update_own") && (ticket.assigneeId === me.user.id || iCollaborate); // assignee and collaborators move the work along
  const requesterCanEdit = ticket.requesterId === me.user.id && (can(me, "ticket.update_own") || !me.isInternal);
  const canEditDetails = triage || requesterCanEdit;
  const canStatus = triage || canRoute || ownStatus || (me.isInternal && requesterCanEdit);
  // Managers/admins can delete any ticket; whoever raised it can delete it while it is still Open, unassigned and unanswered (server re-checks).
  const canDelete = can(me, "ticket.delete") || (ticket.requesterId === me.user?.id && ticket.status === "OPEN" && !ticket.assigneeId && !(ticket._count?.comments > 0));
  const linked = tasks.filter((t) => t.ticketId === ticket.id);
  const linkedTree = buildTree(collectThread(tasks, { ticketId: ticket.id }));
  const linkedRoots = linkedTree.map((n) => n.task).filter((t) => !t.autoCreated); // the ticket's auto record is plumbing
  const rootsDone = linkedRoots.filter((t) => t.status === "DONE").length;
  const inReview = linkedRoots.filter((t) => t.status === "REVIEW").length;
  const countIncompleteWork = (nodes) => nodes.reduce((total, node) => total + ((!node.task.autoCreated && node.task.status !== "DONE") ? 1 : 0) + countIncompleteWork(node.children || []), 0);
  const incompleteWorkCount = countIncompleteWork(linkedTree);
  const reviewBlocked = incompleteWorkCount > 0;
  const staff = me.isInternal;
  // Team-to-team ticket (raised by an employee): the person who raised it reviews, approves or sends back, like a client.
  const teamToTeam = staff && Boolean(ticket.requesterIsEmployee);
  const isRequester = ticket.requesterId === me.user.id;
  const peerReview = teamToTeam && isRequester && ticket.assigneeId !== me.user.id;
  // Teams that are SAVED on the ticket decide who can be assigned. Unsaved changes in the pickers do not.
  const savedShared = (ticket.teamAccesses || []).filter((a) => a.teamId !== ticket.teamId).map((a) => a.teamId);
  const groups = assigneeGroups(teams, ticket.teamId, savedShared);
  const savedAccessIds = groups.map((g) => g.team.id);
  const legacyAssignee = ticket.assignee && ticket.teamId && !isInTeams(teams, savedAccessIds, ticket.assigneeId) ? ticket.assignee : null;
  // Collaborators: people of ANY of the saved teams (several teams at once), next to the single assignee.
  const savedCollabIds = (ticket.collaborators || []).map((c) => c.userId);
  const collabPeople = peopleOfTeams(teams, savedAccessIds).filter((p) => p.id !== ticket.assigneeId).map((p) => ({ id: p.id, name: p.label }));
  const collabNames = (ticket.collaborators || []).map((c) => c.user?.name || c.user?.email).filter(Boolean);
  const collabChanged = !sameIds(collabIds, savedCollabIds);
  const sharedNow = selectedTeamIds.filter((id) => id !== ownerTeamId);
  const teamsDirty = ownerTeamId !== (ticket.teamId || "") || !sameIds(sharedNow, savedShared);
  const canSaveTeams = teamsDirty && (ownerTeamId || !sharedNow.length);
  const saveTeams = async () => {
    // The assignee must belong to the saved teams, so clear them if they would no longer fit.
    const fits = ticket.assigneeId && ownerTeamId && isInTeams(teams, [ownerTeamId, ...sharedNow], ticket.assigneeId);
    await onUpdate(ticket.id, { teamId: ownerTeamId || null, teamIds: ownerTeamId ? sharedNow : [], ...(ticket.assigneeId && !fits ? { assigneeId: null } : {}) });
  };

  const clientReview = (!staff || peerReview) && ticket.status === "REVIEW_TEST" && (
    <div className="linked-task">
      <ThumbsUp size={22} color="#5746e8" />
      <span><b>Ready for your review</b><small>{staff ? "The team finished this ticket. " : ""}Approve it, or send it back with a comment explaining what to change.</small></span>
      <button className="primary" onClick={() => onUpdate(ticket.id, { status: "CLOSED" })}>Approve</button>
      <button className="secondary" onClick={() => onUpdate(ticket.id, { status: "OPEN" })}><Undo2 size={14} /> Send back</button>
    </div>
  );
  const clientTasks = !staff && ticket.status === "OPEN" && ticket.tasksInReview > 0 && (
    <div className="linked-task">
      <ThumbsUp size={22} color="#5746e8" />
      <span><b>{ticket.tasksInReview} task{ticket.tasksInReview === 1 ? " is" : "s are"} ready for your review</b><small>Approve each one, or ask for changes. When the last task is approved, the ticket closes by itself.</small></span>
      <button className="primary" onClick={() => setTab("tasks")}>Review now</button>
    </div>
  );
  const clientHelp = !staff && ticket.status === "REVIEW_HELP" && (
    <div className="linked-task">
      <Info size={22} color="#a05a00" />
      <span><b>The team needs more information</b><small>Add your answer in a comment below, then tell the team to continue.</small></span>
      <button className="primary" onClick={() => onUpdate(ticket.id, { status: "OPEN" })}>I have replied, continue</button>
    </div>
  );

  const who = (u) => u && (u.name || u.email);
  const teamLabel = ticketTeamLabel(ticket);
  const dueDay = ticket.dueDate ? String(ticket.dueDate).slice(0, 10) : "";
  const overdue = Boolean(dueDay) && ticket.status !== "CLOSED" && dueDay < new Date().toISOString().slice(0, 10);
  const allWork = tasks.filter((t) => t.ticketId === ticket.id && !t.autoCreated);
  const workDone = allWork.filter((t) => t.status === "DONE").length;
  const commentCount = disc?.comments ?? comments.length;
  const fileCount = disc?.files ?? (ticket._count?.attachments || 0);

  const teamCard = staff && (canRoute ? (
    <section className="tv-card">
      <h3>Team &amp; people</h3>
      <Row label="Team" htmlFor="ticket-owner-team" stack>
        <select id="ticket-owner-team" value={ownerTeamId} onChange={(e) => setOwnerTeamId(e.target.value)} aria-label="Owning team">
          <option value="">Not routed — pick a team</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </Row>
      <Row label="Also share with" htmlFor="ticket-shared-teams" stack>
        <TeamMultiSelect id="ticket-shared-teams" teams={teams} value={selectedTeamIds} onChange={setSelectedTeamIds} lockedId={ownerTeamId} disabled={!ownerTeamId} />
        {!ownerTeamId && <small className="hint">Choose the owning team first.</small>}
      </Row>
      {teamsDirty && <button className="primary" disabled={!canSaveTeams} onClick={saveTeams}>Save team access</button>}
      <Row label="Assignee" htmlFor="ticket-assignee" stack>
        <select id="ticket-assignee" value={ticket.assigneeId || ""} disabled={!ticket.teamId || teamsDirty} onChange={(e) => onUpdate(ticket.id, { assigneeId: e.target.value || null })} aria-label="Assignee">
          <option value="">{teamsDirty ? "Save team access first" : ticket.teamId ? "Unassigned" : "Select a team first"}</option>
          {legacyAssignee && <option value={legacyAssignee.id}>{legacyAssignee.name || legacyAssignee.email} (not in these teams — reassign)</option>}
          {groups.map((g) => (
            <optgroup key={g.team.id} label={`${g.team.name}${g.owner ? " (owner team)" : " (shared)"}`}>
              {g.people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </optgroup>
          ))}
        </select>
        <small className="hint">Pick the team and save first, then assign someone from it.</small>
      </Row>
      <Row label="Collaborators" stack>
        {ticket.teamId && !teamsDirty ? (
          <>
            <PeoplePicker key={`${savedAccessIds.join("|")}#${ticket.assigneeId || ""}#${savedCollabIds.join("|")}`} users={collabPeople} defaultValue={collabIds} onChange={setCollabIds} />
            {collabChanged && <button type="button" className="secondary" onClick={() => onUpdate(ticket.id, { collaboratorIds: collabIds.filter((id) => collabPeople.some((p) => p.id === id)) })}>Save collaborators</button>}
          </>
        ) : <small className="hint">{teamsDirty ? "Save team access first" : "Select a team first"}</small>}
      </Row>
    </section>
  ) : (
    <section className="tv-card">
      <h3>Team &amp; people</h3>
      <Row label="Team">{ticket.teamAccesses?.find((a) => a.teamId === ticket.teamId)?.team?.name || "Not routed yet"}</Row>
      <Row label="Assignee">{who(ticket.assignee) || "Unassigned"}</Row>
      <Row label="Collaborators">{collabNames.length ? collabNames.join(", ") : "None"}</Row>
    </section>
  ));

  const side = (
    <>
      {staff && <TicketReminder ticket={ticket} />}
      <section className="tv-card">
        <h3>Status</h3>
        <Row label="Status" htmlFor="ticket-status">
          {canStatus
            ? <select id="ticket-status" value={ticket.status} onChange={(e) => onUpdate(ticket.id, { status: e.target.value })} aria-label="Status">{STATUSES.filter((st) => !staff || triage || (teamToTeam && isRequester) || st !== "CLOSED").map((st) => { const gated = ["REVIEW_TEST", "CLOSED"].includes(st) && st !== ticket.status && reviewBlocked; return <option key={st} value={st} disabled={gated}>{STATUS_LABEL[st]}{gated ? " (finish linked work first)" : ""}</option>; })}</select>
            : staff ? <TicketStatusBadge ticket={ticket} /> : clientStatusText(ticket)}
        </Row>
        {staff && reviewBlocked && <p className="tv-note" role="status"><Info size={13} /> Review is locked: {incompleteWorkCount} linked task{incompleteWorkCount === 1 ? " still needs" : "s still need"} to be marked Done.</p>}
        {staff && (PROGRESS_FOR[ticket.status] || []).length > 0 && (
          <Row label="Progress" htmlFor="ticket-progress">
            {canStatus
              ? <select id="ticket-progress" value={ticket.progress || ""} onChange={(e) => onUpdate(ticket.id, { progress: e.target.value || null })} aria-label="Progress">{ticket.status === "OPEN" && <option value="">Not started</option>}{PROGRESS_FOR[ticket.status].map((p) => <option key={p} value={p}>{PROGRESS_LABEL[p]}</option>)}</select>
              : ticket.progress ? PROGRESS_LABEL[ticket.progress] : "Not started"}
          </Row>
        )}
        <Row label="Priority" htmlFor="ticket-priority">
          {triage
            ? <select id="ticket-priority" value={ticket.priority} onChange={(e) => onUpdate(ticket.id, { priority: e.target.value })} aria-label="Priority">{PRIORITIES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</select>
            : <PriorityBadge value={ticket.priority} />}
        </Row>
        <Row label="Due">{formatDate(ticket.dueDate)}{overdue && <em className="tv-late">Overdue</em>}</Row>
        <Row label={ticket.closedAt ? "Closed in" : "Open for"}>{dayLabel(daysPassed(ticket))}</Row>
        {!staff && <Row label="Assignee">{who(ticket.assignee) || "Unassigned"}</Row>}
      </section>
      {teamCard}
      {staff && (
        <section className="tv-card">
          <h3>Linked tasks{linkedRoots.length > 0 && <span className="tv-count">{rootsDone}/{linkedRoots.length} done{inReview > 0 ? `, ${inReview} in review` : ""}</span>}</h3>
          {linkedRoots.length > 0 && (
            <>
              <div className="progress" aria-hidden="true"><i style={{ width: `${Math.round((rootsDone / linkedRoots.length) * 100)}%` }} /></div>
              <div className="linked-rows">
                {linkedRoots.map((t) => {
                  const subs = linkedTree.flatMap(function walk(n) { return [n, ...n.children.flatMap(walk)]; }).filter((n) => n.task.parentId === t.id);
                  return (
                    <button key={t.id} type="button" onClick={() => onOpenTask?.(t)} aria-label={`Open task ${t.title}`}>
                      <span><b>{t.title}</b><small style={{ display: "block" }}>{taskPeople(t).join(", ") || "Unassigned"}{subs.length ? `, ${subs.filter((n) => n.task.status === "DONE").length}/${subs.length} subtasks` : ""}</small></span>
                      <StatusBadge value={t.status} />
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {linkedRoots.length === 0 && <p className="tv-note">{ticket.teamId ? "No tasks yet. Branch work off this ticket for your team or another one." : "Route the ticket to a team before adding tasks."}</p>}
          {can(me, "task.create") && <button className="secondary" disabled={!ticket.teamId} onClick={() => onAddTask?.(ticket)}><Plus size={14} /> Add linked task</button>}
        </section>
      )}
      {canDelete && onDelete && (
        <button type="button" className="tv-delete"
          onClick={() => { if (window.confirm(`Delete ${ticket.key}? Its comments, files and history are removed and this cannot be undone.`)) onDelete(ticket); }}>
          <Trash2 size={14} /> Delete ticket
        </button>
      )}
    </>
  );

  const head = (
    <>
      <b className="win-key">{ticket.key}</b>
      <span className="tv-head-actions">
        <CopyLinkButton ticket={ticket} label />
        {canEditDetails && !editing && <button type="button" className="secondary tv-edit" onClick={() => setEditing(true)} aria-label="Edit ticket details"><Pencil size={14} /> Edit</button>}
      </span>
    </>
  );

  const tabBtn = (id, label, count, extra) => (
    <button key={id} role="tab" type="button" aria-selected={tab === id} className="tv-tab" onClick={() => setTab(id)}>
      {label}{count !== undefined && count !== null && <i>{count}</i>}{extra}
    </button>
  );

  return (
    <Window label={`Ticket ${ticket.key}`} onClose={onClose} side={side} head={head} className="tv">
      {clientReview}
      {clientTasks}
      {clientHelp}
      {editing ? (
        <div className="field tv-edit-form">
          <label htmlFor="ticket-edit-title">Ticket title</label>
          <input id="ticket-edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={220} />
          <label htmlFor="ticket-edit-description">Description</label>
          <PasteTextarea id="ticket-edit-description" value={editDescription} onChange={setEditDescription} rows={5} target={{ ticketId: ticket.id }} onOtherFile={(f) => onUpload({ target: { files: [f], value: "" } }, ticket.id)} onError={(m) => setPasteHint(m)} placeholder="Paste a screenshot or PDF here with Ctrl+V to attach it" />
          <div className="row"><button className="primary" disabled={!editTitle.trim()} onClick={async () => { const saved = await onUpdate(ticket.id, { title: editTitle.trim(), description: editDescription }); if (saved) setEditing(false); }}><Check size={14} /> Save details</button><button className="secondary" onClick={() => { setEditTitle(ticket.title); setEditDescription(ticket.description || ""); setEditing(false); }}><XCircle size={14} /> Cancel</button></div>
        </div>
      ) : (
        <>
          <div className="tv-top">
            <h2 className="tv-title"><Linkify text={ticket.title} /></h2>
            <div className="tv-chips">
              {staff ? <TicketStatusBadge ticket={ticket} /> : <span className="status s-open">{clientStatusText(ticket)}</span>}
              <PriorityBadge value={ticket.priority} />
              <span className={`tv-due${overdue ? " late" : ""}`}>{ticket.dueDate ? `Due ${formatDate(ticket.dueDate)}` : "No due date"}{overdue ? " · overdue" : ""}</span>
            </div>
            <div className="tv-meta">
              <span>Raised by <b className="who">{ticket.requester && <Avatar name={ticket.requester.name || ticket.requester.email} />}{who(ticket.requester) || "—"}</b> on {formatDate(ticket.createdAt)}</span>
              {ticket.organization?.name && <span>Client <b>{ticket.organization.name}</b></span>}
              <span>Updated <b>{formatDate(ticket.updatedAt)}</b></span>
            </div>
          </div>

          <Steps ticket={ticket} staff={staff} />

          {staff && (
            <div className="tv-route" aria-label="Where the work is">
              <div className={`tv-node${teamLabel ? "" : " todo"}`}><small>Team</small><b>{teamLabel || "Not routed"}</b></div>
              <div className={`tv-node${ticket.assignee ? "" : " todo"}`}><small>Assignee</small><b>{who(ticket.assignee) || "Unassigned"}</b>{collabNames.length > 0 && <em>+ {collabNames.join(", ")}</em>}</div>
              <div className="tv-node"><small>Tasks</small><b>{allWork.length ? `${workDone} of ${allWork.length} done` : "None yet"}</b></div>
            </div>
          )}

          <section className="tv-desc" aria-label="Description">
            {ticket.description ? <RichText text={ticket.description} canDelete={canEditDetails || triage} /> : <p className="tv-empty">No description added.</p>}
            {can(me, "file.upload") && <button type="button" className="tv-attach" onClick={() => setTab("comments")}><Paperclip size={14} /> Attach files</button>}
          </section>
        </>
      )}

      <div className="tv-tabs" role="tablist">
        {tabBtn("comments", "Comments", commentCount, fileCount > 0 && <span className="tv-files"><Paperclip size={12} />{fileCount}</span>)}
        {staff && tabBtn("activity", "Timeline")}
        {!staff && tabBtn("tasks", "Tasks", ticket.tasksInReview > 0 ? `${ticket.tasksInReview} to review` : null)}
        {!staff && tabBtn("history", "History")}
      </div>
      {staff && tab === "activity" && <ActivityTab ticket={ticket} tasks={collectThread(tasks, { ticketId: ticket.id })} onOpenTask={onOpenTask} showRoles refreshKey={`${ticket.updatedAt}|${ticket.status}|${ticket.assigneeId}|${ticket.teamId}|${linked.length}|${(ticket.teamAccesses || []).length}|${(ticket.collaborators || []).length}|${commentCount}|${ticket._count?.attachments || 0}`} />}
      {!staff && tab === "tasks" && <TicketTasks ticketId={ticket.id} canReview={ticket.status === "OPEN"} onChanged={onRefresh} notify={notify} refreshKey={`${ticket.updatedAt}|${ticket.status}|${ticket.progress}|${ticket.tasksInReview}`} />}
      {!staff && tab === "history" && <TicketHistory ticketId={ticket.id} showRoles={false} refreshKey={`${ticket.updatedAt}|${ticket.status}|${ticket.assigneeId}|${ticket.teamId}|${commentCount}|${ticket._count?.attachments || 0}|${(ticket.teamAccesses || []).length}`} />}
      {tab === "comments" && <Discussion kind="ticket" id={ticket.id} me={me} staff={staff} canUpload={can(me, "file.upload")} canModerate={triage} onChanged={onRefresh} onCount={setDisc} notify={notify} refreshKey={ticket.id} />}
    </Window>
  );
}
