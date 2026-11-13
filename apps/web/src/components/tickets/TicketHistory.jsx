import { useEffect, useState } from "react";
import { api } from "../../api";
import { describeEvent, actorLabel, groupByDay } from "../../lib/ticketHistory";
import { fmtTime } from "../../lib/dates";

// Per-ticket timeline: who changed what, and when. `refreshKey` reloads it when the ticket changes.
const ROUTE = ["TEAM", "TEAM_ACCESS", "ASSIGNEE", "COLLABORATOR"];
const TALK = ["COMMENT", "ATTACHMENT"];
const FILTERS = [["all", "All"], ["route", "Routing"], ["status", "Status & details"], ["talk", "Comments & files"]];
const keep = (f, e) => f === "all" || (f === "route" ? ROUTE.includes(e.type) : f === "talk" ? TALK.includes(e.type) : !ROUTE.includes(e.type) && !TALK.includes(e.type));

export default function TicketHistory({ ticketId, refreshKey, showRoles, filterable = false }) {
  const [events, setEvents] = useState(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api.get(`/tickets/${ticketId}/history`)
      .then((r) => { if (live) { setEvents(r.data); setError(""); } })
      .catch(() => { if (live) setError("Could not load the history."); });
    return () => { live = false; };
  }, [ticketId, refreshKey]);

  if (error) return <p className="hint">{error}</p>;
  if (!events) return <p className="hint">Loading history…</p>;
  if (!events.length) return <p className="hint">No history yet.</p>;

  const shown = events.filter((e) => keep(filter, e));
  return (
    <div className="history">
      {filterable && <div className="doc-filters" role="group" aria-label="Filter history" style={{ marginBottom: 10 }}>{FILTERS.map(([id, label]) => <button key={id} type="button" className={`pill${filter === id ? " on" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>}
      {!shown.length && <p className="hint">Nothing in this view.</p>}
      {groupByDay(shown).map((g) => (
        <section key={g.day}>
          <small className="history-day">{g.day}</small>
          {g.events.map((e) => (
            <div className={`history-item type-${String(e.type).toLowerCase()}`} key={e.id}>
              <span className="history-dot" aria-hidden="true" />
              <div>
                <p><b>{actorLabel(e, showRoles)}</b> {describeEvent(e)}</p>
                {e.note && e.type !== "CREATED" && <small className="history-note">{e.note}</small>}
                <small>{fmtTime(e.createdAt)}</small>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
