import { useCallback, useEffect, useState } from "react";
import { Flag, BellPlus } from "lucide-react";
import { api } from "../../api";

// Personal flag + reminder for the open ticket. Only the signed-in team member sees their own.
export default function TicketReminder({ ticket }) {
  const [items, setItems] = useState([]);
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api.get("/reminders/mine", { params: { ticketId: ticket.id } }).then((r) => setItems(r.data)).catch(() => setItems([])), [ticket.id]);
  useEffect(() => { load(); setMsg(""); }, [load]);
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
      setWhen(""); setMsg("Reminder set."); load();
    } catch (e) { setMsg(e.response?.data?.error || "Could not set reminder"); }
  };
  return (
    <div className="linked-task" style={{ flexWrap: "wrap" }}>
      <Flag size={22} color={flag ? "#e8462f" : "#5746e8"} />
      <span><b>Flag &amp; remind</b><small>Only you can see these.</small></span>
      <button className={flag ? "primary" : "secondary"} onClick={toggleFlag} aria-pressed={!!flag}>{flag ? "Flagged" : "Flag"}</button>
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Remind me at" />
      <button className="secondary" disabled={!when} onClick={add}><BellPlus size={14} /> Remind me</button>
      {upcoming.map((r) => <small key={r.id} className="hint" style={{ flexBasis: "100%" }}>Reminder: {new Date(r.remindAt).toLocaleString()}{r.notifiedAt ? " (sent)" : ""}</small>)}
      {msg && <small className="hint" style={{ flexBasis: "100%" }}>{msg}</small>}
    </div>
  );
}
