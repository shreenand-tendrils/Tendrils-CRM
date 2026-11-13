import { useCallback, useEffect, useState } from "react";
import { Flag, BellPlus } from "lucide-react";
import { api } from "../../api";
import { fmtDateTime } from "../../lib/dates";

// Personal flag + reminder for the open ticket, as one slim bar. Only the signed-in team member sees their own.
export default function TicketReminder({ ticket }) {
  const [items, setItems] = useState([]);
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api.get("/reminders/mine", { params: { ticketId: ticket.id } }).then((r) => setItems(r.data)).catch(() => setItems([])), [ticket.id]);
  useEffect(() => { load(); setMsg(""); setOpen(false); }, [load]);
  const flag = items.find((r) => r.flagged && !r.remindAt && !r.doneAt);
  const upcoming = items.filter((r) => r.remindAt && !r.doneAt);
  const toggleFlag = async () => {
    try {
      if (flag) await api.delete(`/reminders/${flag.id}`);
      else await api.post("/reminders", { title: `Follow up: ${ticket.key}`, ticketId: ticket.id, flagged: true });
      load();
    } catch (e) { setMsg(e.response?.data?.error || "Could not update flag"); }
  };
  const add = async () => {
    try {
      await api.post("/reminders", { title: `Check ${ticket.key}: ${ticket.title}`.slice(0, 200), ticketId: ticket.id, remindAt: new Date(when).toISOString() });
      setWhen(""); setOpen(false); setMsg("Reminder set."); load();
    } catch (e) { setMsg(e.response?.data?.error || "Could not set reminder"); }
  };
  return (
    <div className="rem-mini">
      <div className="rem-mini-bar">
        <button type="button" className={`rem-chip${flag ? " on" : ""}`} onClick={toggleFlag} aria-pressed={!!flag} title="Flag this ticket. Only you can see flags."><Flag size={14} /> {flag ? "Flagged" : "Flag"}</button>
        <button type="button" className={`rem-chip${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Remind me about this ticket. Only you can see reminders."><BellPlus size={14} /> Remind me</button>
        <small className="hint">Private to you</small>
      </div>
      {open && (
        <div className="rem-mini-form">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Remind me at" />
          <button type="button" className="btn-soft sm" disabled={!when} onClick={add}>Set</button>
        </div>
      )}
      {upcoming.map((r) => <small key={r.id} className="hint rem-mini-line">Reminder: {fmtDateTime(r.remindAt)}{r.notifiedAt ? " (sent)" : ""}</small>)}
      {msg && <small className="hint rem-mini-line">{msg}</small>}
    </div>
  );
}
