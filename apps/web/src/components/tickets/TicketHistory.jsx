import { useEffect, useState } from "react";
import { api } from "../../api";
import { describeEvent, actorLabel, groupByDay } from "../../lib/ticketHistory";

// Per-ticket timeline: who changed what, and when. `refreshKey` reloads it when the ticket changes.
export default function TicketHistory({ ticketId, refreshKey, showRoles }) {
  const [events, setEvents] = useState(null);
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

  return (
    <div className="history">
      {groupByDay(events).map((g) => (
        <section key={g.day}>
          <small className="history-day">{g.day}</small>
          {g.events.map((e) => (
            <div className={`history-item type-${String(e.type).toLowerCase()}`} key={e.id}>
              <span className="history-dot" aria-hidden="true" />
              <div>
                <p><b>{actorLabel(e, showRoles)}</b> {describeEvent(e)}</p>
                {e.note && e.type !== "CREATED" && <small className="history-note">{e.note}</small>}
                <small>{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
