import { useEffect, useState } from "react";
import { Flag, Users, Share2, UserCheck, UserPlus, UserMinus, CircleDot, CheckCircle2, Eye, EyeOff, PauseCircle, ListChecks, MessageSquare, Paperclip, Pencil, Zap, CalendarClock, FolderKanban, ArrowRight, ArrowDownUp } from "lucide-react";
import { api } from "../../api";
import { describeEvent, actorLabel, groupByDay } from "../../lib/ticketHistory";
import { statusKeyLabel } from "../../lib/ticketStatus";
import { fmtDateTime, fmtDate } from "../../lib/dates";

const pretty = (v = "") => String(v).toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const label = (e, side) => (side === "from" ? e.fromLabel || statusKeyLabel(e.fromValue) : e.toLabel || statusKeyLabel(e.toValue));

/**
 * How one history event looks on the route.
 * major = a station on the main line (who holds the work changed). minor = a small dot (something was said or edited).
 */
export function present(e) {
  switch (e.type) {
    case "CREATED": return { major: true, tone: "violet", Icon: Flag, title: "Ticket raised" };
    case "TEAM":
      if (e.toLabel && e.fromLabel) return { major: true, tone: "teal", Icon: Users, title: `Moved to ${e.toLabel}`, chips: [e.fromLabel, e.toLabel] };
      if (e.toLabel) return { major: true, tone: "teal", Icon: Users, title: `Routed to ${e.toLabel}` };
      return { major: true, tone: "grey", Icon: Users, title: `Removed from ${e.fromLabel || "its team"}` };
    case "TEAM_ACCESS": return e.toLabel ? { major: true, tone: "teal", Icon: Share2, title: `Shared with ${e.toLabel}` } : { major: true, tone: "grey", Icon: Share2, title: `Stopped sharing with ${e.fromLabel}` };
    case "ASSIGNEE":
      if (e.toLabel && e.fromLabel) return { major: true, tone: "orange", Icon: UserCheck, title: `Reassigned to ${e.toLabel}`, chips: [e.fromLabel, e.toLabel] };
      if (e.toLabel) return { major: true, tone: "orange", Icon: UserCheck, title: `Assigned to ${e.toLabel}` };
      return { major: true, tone: "grey", Icon: UserMinus, title: `Unassigned ${e.fromLabel || ""}`.trim() };
    case "COLLABORATOR": return e.toLabel ? { major: true, tone: "orange", Icon: UserPlus, title: `${e.toLabel} added as collaborator` } : { major: true, tone: "grey", Icon: UserMinus, title: `${e.fromLabel || "A collaborator"} removed` };
    case "STATUS": {
      const to = String(e.toValue || ""), from = String(e.fromValue || "");
      const t = to.startsWith("CLOSED") ? { tone: "green", Icon: CheckCircle2, title: "Closed" }
        : to.startsWith("REVIEW_TEST") ? { tone: "amber", Icon: Eye, title: "Sent for review" }
        : to.startsWith("REVIEW_HELP") ? { tone: "amber", Icon: PauseCircle, title: "Waiting for more information" }
        : from.startsWith("CLOSED") ? { tone: "blue", Icon: CircleDot, title: "Reopened" }
        : { tone: "blue", Icon: CircleDot, title: `Status: ${label(e, "to")}` };
      return { major: true, ...t, chips: [label(e, "from"), label(e, "to")] };
    }
    case "TASK": return { major: true, tone: "red", Icon: ListChecks, title: `Task added: ${e.toLabel || "task"}` };
    case "TASK_REVIEW": return { major: true, tone: "red", Icon: ListChecks, title: describeEvent(e).replace(/^./, (c) => c.toUpperCase()) };
    case "COMMENT": return { tone: e.clientVisible ? "grey" : "amber", Icon: MessageSquare };
    case "ATTACHMENT": return { tone: "grey", Icon: Paperclip };
    case "PRIORITY": return { tone: "grey", Icon: Zap, chips: [pretty(e.fromValue), pretty(e.toValue)] };
    case "DUE_DATE": return { tone: "grey", Icon: CalendarClock, chips: [e.fromValue ? fmtDate(e.fromValue) : "none", e.toValue ? fmtDate(e.toValue) : "none"] };
    case "VISIBILITY": return { tone: "grey", Icon: EyeOff };
    case "PROJECT": return { tone: "grey", Icon: FolderKanban };
    default: return { tone: "grey", Icon: Pencil };
  }
}

const ROUTE = ["CREATED", "TEAM", "TEAM_ACCESS", "ASSIGNEE", "COLLABORATOR", "STATUS", "TASK", "TASK_REVIEW"];
const TALK = ["COMMENT", "ATTACHMENT"];
const FILTERS = [["all", "Everything"], ["route", "Route & status"], ["details", "Edits"], ["talk", "Comments & files"]];
const keep = (f, e) => f === "all" || (f === "route" ? ROUTE.includes(e.type) : f === "talk" ? TALK.includes(e.type) : !ROUTE.includes(e.type) && !TALK.includes(e.type));

function Chips({ from, to }) {
  return <span className="rt-chips"><i>{from || "none"}</i><ArrowRight size={13} /><i className="to">{to || "none"}</i></span>;
}

export default function TicketRoute({ ticketId, refreshKey, showRoles = false }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [newest, setNewest] = useState(true);

  useEffect(() => {
    let live = true;
    api.get(`/tickets/${ticketId}/history`).then((r) => { if (live) { setEvents(r.data); setError(""); } }).catch(() => { if (live) setError("Could not load the route."); });
    return () => { live = false; };
  }, [ticketId, refreshKey]);

  if (error) return <p className="hint">{error}</p>;
  if (!events) return <p className="hint">Loading route…</p>;
  if (!events.length) return <p className="disc-empty">Nothing has happened on this ticket yet.</p>;

  const sorted = [...events].filter((e) => keep(filter, e)).sort((a, b) => (newest ? 1 : -1) * (new Date(b.createdAt) - new Date(a.createdAt)));
  const stations = events.filter((e) => ROUTE.includes(e.type)).length;

  return (
    <div className="rt">
      <div className="rt-bar">
        <div className="seg" role="group" aria-label="What to show">
          {FILTERS.map(([id, text]) => <button key={id} type="button" className={filter === id ? "on" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{text}</button>)}
        </div>
        <button type="button" className="tw-link rt-order" onClick={() => setNewest((n) => !n)}><ArrowDownUp size={14} /> {newest ? "Newest first" : "Oldest first"}</button>
      </div>
      <p className="rt-legend"><span><i className="violet" />Raised</span><span><i className="teal" />Team</span><span><i className="orange" />Person</span><span><i className="blue" />Status</span><span><i className="amber" />Review</span><span><i className="green" />Closed</span><span><i className="red" />Task</span><b>{stations} station{stations === 1 ? "" : "s"} so far</b></p>
      {!sorted.length ? <p className="disc-empty">Nothing in this view.</p> : (
        <ol className="rt-line">
          {groupByDay(sorted).map((g) => (
            <li className="rt-day-wrap" key={g.day}>
              <span className="rt-day">{g.day}</span>
              <ol>
                {g.events.map((e) => {
                  const p = present(e);
                  const { Icon } = p;
                  return p.major ? (
                    <li className={`rt-item major ${p.tone}`} key={e.id}>
                      <span className="rt-node"><Icon size={17} /></span>
                      <div className="rt-card">
                        <div className="rt-card-top"><b>{p.title}</b><small>{fmtDateTime(e.createdAt)}</small></div>
                        {p.chips && p.chips[1] && <Chips from={p.chips[0]} to={p.chips[1]} />}
                        <small className="rt-by">by {actorLabel(e, showRoles)}</small>
                        {e.note && e.type !== "CREATED" && <small className="rt-note">{e.note}</small>}
                      </div>
                    </li>
                  ) : (
                    <li className={`rt-item minor ${p.tone}`} key={e.id}>
                      <span className="rt-node"><Icon size={11} /></span>
                      <div className="rt-mini">
                        <span><b>{actorLabel(e, showRoles)}</b> {describeEvent(e)}</span>
                        {p.chips && p.chips[1] && <Chips from={p.chips[0]} to={p.chips[1]} />}
                        <small>{fmtDateTime(e.createdAt)}</small>
                        {e.note && <small className="rt-note">{e.note}</small>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
