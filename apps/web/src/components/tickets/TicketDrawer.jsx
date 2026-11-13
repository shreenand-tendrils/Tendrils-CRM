import { useEffect, useState } from "react";
import { Trash2, ListChecks, Info, ThumbsUp, Undo2, Pencil, Check, XCircle, Plus, ArrowRight, Users, GitBranch, Lock, Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { pretty, formatDate } from "../../lib/formatters";
import { PriorityBadge, StatusBadge, TicketStatusBadge } from "../ui/StatusBadge";
import { can, ROLE_LABELS } from "../../lib/rbac";
import { assigneeGroups, isInTeams, sameIds, peopleOfTeams } from "../../lib/teams";
import PeoplePicker from "../ui/PeoplePicker";
import TeamMultiSelect from "../ui/TeamMultiSelect";
import TicketHistory from "./TicketHistory";
import TicketRoute from "./TicketRoute";
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
import TicketJourney from "./TicketJourney";
import WorkThread from "../work/WorkThread";
import { WinTabs, SideCard, Row, Panel2 } from "../win/WinParts";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export default function TicketDrawer({ ticket, comments, me, users = [], teams = [], tasks = [], onClose, onUpdate, onAddComment, onUpload, onAddTask, onOpenTask, onDelete, onRefresh, notify }) {
  const [pasteHint, setPasteHint] = useState("");
  const [tab, setTab] = useState(!me?.isInternal && ticket?.tasksInReview > 0 ? "tasks" : "overview");
  const [routeOpen, setRouteOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
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
  useEffect(() => { setTab(!me?.isInternal && ticket?.tasksInReview > 0 ? "tasks" : "overview"); setDisc(null); setRouteOpen(false); setCollabOpen(false); }, [ticket?.id, me?.isInternal]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const ownerName = teams.find((t) => t.id === ticket.teamId)?.name || ticket.teamAccesses?.find((a) => a.teamId === ticket.teamId)?.team?.name || "";
  const sharedNames = (ticket.teamAccesses || []).filter((a) => a.teamId !== ticket.teamId).map((a) => a.team?.name || teams.find((t) => t.id === a.teamId)?.name).filter(Boolean);
  const nComments = (disc?.comments ?? comments.length) + (disc?.files ?? (ticket._count?.attachments || 0));
  const rk = `${ticket.updatedAt}|${ticket.status}|${ticket.progress}|${ticket.assigneeId}|${ticket.teamId}|${linked.length}|${(ticket.teamAccesses || []).length}|${(ticket.collaborators || []).length}|${nComments}`;
  const open = ticket.status !== "CLOSED";

  // ---- things somebody has to act on (shown above the tabs) ----
  const banner = (icon, tone, title, text, actions) => (
    <div className={`tw-banner ${tone}`} role="status">{icon}<span><b>{title}</b>{text && <small>{text}</small>}</span>{actions && <span className="tw-banner-actions">{actions}</span>}</div>
  );
  const clientReview = (!staff || peerReview) && ticket.status === "REVIEW_TEST" && banner(<ThumbsUp size={20} />, "action", "Ready for your review", `${staff ? "The team finished this ticket. " : ""}Approve it, or send it back with a comment explaining what to change.`, <>
    <button className="primary" onClick={() => onUpdate(ticket.id, { status: "CLOSED" })}>Approve</button>
    <button className="secondary" onClick={() => onUpdate(ticket.id, { status: "OPEN" })}><Undo2 size={14} /> Send back</button></>);
  const clientTasks = !staff && ticket.status === "OPEN" && ticket.tasksInReview > 0 && banner(<ThumbsUp size={20} />, "action", `${ticket.tasksInReview} task${ticket.tasksInReview === 1 ? " is" : "s are"} ready for your review`, "Approve each one, or ask for changes. When the last task is approved, the ticket closes by itself.", <button className="primary" onClick={() => setTab("tasks")}>Review now</button>);
  const clientHelp = !staff && ticket.status === "REVIEW_HELP" && banner(<Info size={20} />, "warn", "The team needs more information", "Add your answer in Comments & files, then tell the team to continue.", <>
    <button className="secondary" onClick={() => setTab("comments")}>Write a reply</button>
    <button className="primary" onClick={() => onUpdate(ticket.id, { status: "OPEN" })}>I have replied, continue</button></>);
  const nextStep = staff && canRoute && open && (!ticket.teamId
    ? banner(<ArrowRight size={20} />, "info", "Next step: choose the team", "Pick the team that will handle this ticket in the Team routing card.")
    : !ticket.assigneeId && ticket.status === "OPEN" ? banner(<ArrowRight size={20} />, "info", `Next step: assign someone from ${ownerName || "the team"}`, "Use the Assignment card. Assigning creates a task for that person.") : null);

  // ---- right-hand side: only controls ----
  const statusSelect = canStatus
    ? <select className="tw-select" value={ticket.status} onChange={(e) => onUpdate(ticket.id, { status: e.target.value })} aria-label="Status">{STATUSES.filter((st) => !staff || triage || (teamToTeam && isRequester) || st !== "CLOSED").map((st) => { const gated = ["REVIEW_TEST", "CLOSED"].includes(st) && st !== ticket.status && reviewBlocked; return <option key={st} value={st} disabled={gated}>{STATUS_LABEL[st]}{gated ? " (finish linked work first)" : ""}</option>; })}</select>
    : staff ? <TicketStatusBadge ticket={ticket} /> : <b>{clientStatusText(ticket)}</b>;
  const showRouteForm = routeOpen || !ticket.teamId || teamsDirty;

  const side = (
    <>
      <SideCard title={staff ? "Status" : "Details"} icon={ListChecks}>
        <Row label="Status">{statusSelect}</Row>
        {staff && (PROGRESS_FOR[ticket.status] || []).length > 0 && (
          <Row label="Progress">
            {canStatus
              ? <select className="tw-select" value={ticket.progress || ""} onChange={(e) => onUpdate(ticket.id, { progress: e.target.value || null })} aria-label="Progress">{ticket.status === "OPEN" && <option value="">Not started</option>}{PROGRESS_FOR[ticket.status].map((p) => <option key={p} value={p}>{PROGRESS_LABEL[p]}</option>)}</select>
              : <b>{ticket.progress ? PROGRESS_LABEL[ticket.progress] : "Not started"}</b>}
          </Row>
        )}
        <Row label="Priority">
          {triage
            ? <select className="tw-select" value={ticket.priority} onChange={(e) => onUpdate(ticket.id, { priority: e.target.value })} aria-label="Priority">{PRIORITIES.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}</select>
            : <PriorityBadge value={ticket.priority} />}
        </Row>
        {staff && reviewBlocked && <p className="tw-note"><Lock size={13} /> Review is locked until {incompleteWorkCount} linked task{incompleteWorkCount === 1 ? " is" : "s are"} marked Done.</p>}
      </SideCard>

      {staff && canRoute && (
        <SideCard title="Assignment" icon={Users}>
          <Row label="Assignee">
            <select className="tw-select" value={ticket.assigneeId || ""} disabled={!ticket.teamId || teamsDirty} onChange={(e) => onUpdate(ticket.id, { assigneeId: e.target.value || null })} aria-label="Assignee">
              <option value="">{teamsDirty ? "Save team access first" : ticket.teamId ? "Unassigned" : "Pick a team first"}</option>
              {legacyAssignee && <option value={legacyAssignee.id}>{legacyAssignee.name || legacyAssignee.email} (not in these teams, reassign)</option>}
              {groups.map((g) => (
                <optgroup key={g.team.id} label={`${g.team.name}${g.owner ? " (owner team)" : " (shared)"}`}>
                  {g.people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Row>
          <div className="tw-collab">
            <div className="tw-collab-head"><span>Collaborators</span>
              {ticket.teamId && !teamsDirty && <button type="button" className="tw-link" onClick={() => setCollabOpen((o) => !o)}>{collabOpen ? "Close" : collabNames.length ? "Manage" : "Add"}</button>}
            </div>
            {!collabOpen && (collabNames.length ? <div className="tw-chips">{collabNames.map((n) => <span key={n} className="tw-chip">{n}</span>)}</div> : <small className="tw-muted">None. Add people from the selected teams.</small>)}
            {collabOpen && ticket.teamId && !teamsDirty && (
              <>
                <PeoplePicker key={`${savedAccessIds.join("|")}#${ticket.assigneeId || ""}#${savedCollabIds.join("|")}`} users={collabPeople} defaultValue={collabIds} onChange={setCollabIds} />
                <button type="button" className="primary tw-wide" disabled={!collabChanged} onClick={async () => { await onUpdate(ticket.id, { collaboratorIds: collabIds.filter((id) => collabPeople.some((p) => p.id === id)) }); setCollabOpen(false); }}>Save collaborators</button>
              </>
            )}
          </div>
        </SideCard>
      )}

      {staff && canRoute && (
        <SideCard title="Team routing" icon={GitBranch}
          action={ticket.teamId && !teamsDirty ? <button type="button" className="tw-link" onClick={() => setRouteOpen((o) => !o)}>{routeOpen ? "Close" : "Change"}</button> : null}>
          {!showRouteForm ? (
            <div className="tw-chips"><span className="tw-chip owner">{ownerName || "Team"} <i>owner</i></span>{sharedNames.map((n) => <span key={n} className="tw-chip">{n}</span>)}</div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="ticket-owner-team">Owning team</label>
                <select id="ticket-owner-team" value={ownerTeamId} onChange={(e) => setOwnerTeamId(e.target.value)} aria-label="Owning team">
                  <option value="">Not routed: pick a team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ticket-shared-teams">Also share with (optional)</label>
                <TeamMultiSelect id="ticket-shared-teams" teams={teams} value={selectedTeamIds} onChange={setSelectedTeamIds} lockedId={ownerTeamId} disabled={!ownerTeamId} />
              </div>
              <button className="primary tw-wide" disabled={!canSaveTeams} onClick={async () => { await saveTeams(); setRouteOpen(false); }}>Save team access</button>
            </>
          )}
        </SideCard>
      )}

      {staff && !canRoute && (
        <SideCard title="Team & people" icon={Users}>
          <Row label="Team"><b>{ownerName || "Not routed yet"}</b></Row>
          <Row label="Assignee"><b>{ticket.assignee?.name || ticket.assignee?.email || "Unassigned"}</b></Row>
          <Row label="Collaborators"><b>{collabNames.length ? collabNames.join(", ") : "None"}</b></Row>
        </SideCard>
      )}

      {staff && <SideCard title="Just for you" icon={Bell}><TicketReminder ticket={ticket} /></SideCard>}

      {canDelete && onDelete && (
        <button type="button" className="tw-danger" onClick={() => { if (window.confirm(`Delete ${ticket.key}? Its comments, files and history are removed and this cannot be undone.`)) onDelete(ticket); }}>
          <Trash2 size={14} /> Delete this ticket
        </button>
      )}
    </>
  );

  const headActions = (
    <>
      <CopyLinkButton ticket={ticket} label />
      {canEditDetails && !editing && <button type="button" className="secondary tw-edit" onClick={() => setEditing(true)} aria-label="Edit ticket details"><Pencil size={14} /> Edit</button>}
    </>
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "tasks", label: "Tasks", count: staff ? linkedRoots.length : (ticket.tasksInReview > 0 ? `${ticket.tasksInReview} to review` : null), alert: !staff && ticket.tasksInReview > 0 },
    { id: "comments", label: "Comments & files", count: nComments },
    { id: "history", label: "History" },
  ];

  return (
    <Window
      label={`Ticket ${ticket.key}`} onClose={onClose} side={staff || canStatus ? side : undefined} headRight={headActions}
      head={<><b className="win-key">{ticket.key}</b>{staff ? <TicketStatusBadge ticket={ticket} /> : <b>{clientStatusText(ticket)}</b>}<PriorityBadge value={ticket.priority} /></>}
    >
      {editing ? (
        <div className="tw-edit-box field">
          <label htmlFor="ticket-edit-title">Ticket title</label>
          <input id="ticket-edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={220} />
          <label htmlFor="ticket-edit-description">Description</label>
          <PasteTextarea id="ticket-edit-description" value={editDescription} onChange={setEditDescription} rows={5} target={{ ticketId: ticket.id }} onOtherFile={(f) => onUpload({ target: { files: [f], value: "" } }, ticket.id)} onError={(m) => setPasteHint(m)} placeholder="Paste a screenshot or PDF here with Ctrl+V to attach it" />
          {pasteHint && <small className="hint">{pasteHint}</small>}
          <div className="row"><button className="primary" disabled={!editTitle.trim()} onClick={async () => { const saved = await onUpdate(ticket.id, { title: editTitle.trim(), description: editDescription }); if (saved) setEditing(false); }}><Check size={14} /> Save details</button><button className="secondary" onClick={() => { setEditTitle(ticket.title); setEditDescription(ticket.description || ""); setEditing(false); }}><XCircle size={14} /> Cancel</button></div>
        </div>
      ) : (
        <header className="tw-hero">
          <h2 className="tw-title"><Linkify text={ticket.title} /></h2>
          <p className="tw-meta">
            {ticket.requester && <Avatar name={ticket.requester.name || ticket.requester.email} />}
            <span>Raised by <b>{ticket.requester?.name || ticket.requester?.email || "someone"}</b> on {formatDate(ticket.createdAt)}</span>
            {ticket.organization?.name && <span className="tw-dotsep">{ticket.organization.name}</span>}
            <span className="tw-dotsep">Updated {formatDate(ticket.updatedAt)}</span>
          </p>
        </header>
      )}

      <TicketJourney ticket={ticket} staff={staff} teamName={ownerName} sharedNames={sharedNames} workDone={rootsDone} workTotal={linkedRoots.length} inReview={inReview} />
      {clientReview}{clientTasks}{clientHelp}{nextStep}

      <WinTabs tabs={tabs} value={tab} onChange={setTab} label="Ticket sections" />

      {tab === "overview" && (
        <>
          <Panel2 title="Description">
            {ticket.description ? <RichText text={ticket.description} canDelete={canEditDetails || triage} /> : <p className="tw-empty">No description added.{canEditDetails && <> <button type="button" className="tw-link" onClick={() => setEditing(true)}>Add one</button></>}</p>}
          </Panel2>
          <Panel2 title="Latest activity" action={<button type="button" className="tw-link" onClick={() => setTab("history")}>See everything</button>}>
            <TicketHistory ticketId={ticket.id} showRoles={staff} refreshKey={rk} limit={4} />
          </Panel2>
        </>
      )}

      {tab === "tasks" && staff && (
        <Panel2 title="Linked tasks"
          sub={linkedRoots.length ? `${rootsDone} of ${linkedRoots.length} done${inReview > 0 ? ` · ${inReview} waiting for review` : ""}` : ticket.teamId ? "Branch work off this ticket, for your team or another one." : "Route the ticket to a team before adding tasks."}
          action={can(me, "task.create") && <button className="primary" disabled={!ticket.teamId} onClick={() => onAddTask?.(ticket)}><Plus size={14} /> Add linked task</button>}>
          {linkedRoots.length > 0 && <div className="progress tw-progress" aria-hidden="true"><i style={{ width: `${Math.round((rootsDone / linkedRoots.length) * 100)}%` }} /></div>}
          <WorkThread ticket={ticket} ticketId={ticket.id} currentTicket tasks={collectThread(tasks, { ticketId: ticket.id })} onOpenTask={onOpenTask} refreshKey={rk} hideEvents hideSummary />
        </Panel2>
      )}
      {tab === "tasks" && !staff && <TicketTasks ticketId={ticket.id} canReview={ticket.status === "OPEN"} onChanged={onRefresh} notify={notify} refreshKey={`${ticket.updatedAt}|${ticket.status}|${ticket.progress}|${ticket.tasksInReview}`} />}

      {tab === "comments" && <Discussion kind="ticket" id={ticket.id} me={me} staff={staff} canUpload={can(me, "file.upload")} canModerate={triage} onChanged={onRefresh} onCount={setDisc} notify={notify} refreshKey={ticket.id} />}

      {tab === "history" && <Panel2 title="Route & history" sub="Follow the ticket from the day it was raised: who held it, which team, and every change on the way"><TicketRoute ticketId={ticket.id} showRoles={staff} refreshKey={rk} /></Panel2>}
    </Window>
  );
}
