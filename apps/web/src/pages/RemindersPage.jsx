import { useCallback, useEffect, useState } from "react";
import { Flag, Trash2, Check } from "lucide-react";
import Panel from "../components/ui/Panel";
import EmptyState from "../components/ui/EmptyState";
import { api } from "../api";

export default function RemindersPage({ notify, onOpenTicket }) {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const load = useCallback(() => api.get("/reminders/mine").then((r) => setItems(r.data)).catch(() => notify?.("Could not load reminders", "error")), [notify]);
  useEffect(() => { load(); }, [load]);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post("/reminders", { title, remindAt: new Date(when).toISOString() });
      setTitle(""); setWhen(""); notify?.("Reminder set"); load();
    } catch (err) { notify?.(err.response?.data?.error || "Could not save", "error"); }
  };
  const patch = (id, body) => api.patch(`/reminders/${id}`, body).then(load).catch(() => notify?.("Update failed", "error"));
  const remove = (id) => api.delete(`/reminders/${id}`).then(load).catch(() => notify?.("Delete failed", "error"));
  const open = items.filter((r) => !r.doneAt);
  const done = items.filter((r) => r.doneAt);
  const row = (r) => (
    <div className="notification" key={r.id}>
      <Flag size={18} color={r.flagged ? "#e8462f" : "#9aa0b4"} />
      <span>
        <b>{r.title}</b>
        <small>
          {r.remindAt ? `Due ${new Date(r.remindAt).toLocaleString()}` : "Flagged"}
          {r.ticket && <> · <a href="#open" onClick={(e) => { e.preventDefault(); onOpenTicket?.(r.ticket); }}>{r.ticket.key}</a></>}
        </small>
      </span>
      {!r.doneAt && <button className="secondary" onClick={() => patch(r.id, { done: true })} aria-label="Mark done"><Check size={14} /></button>}
      {r.doneAt && <button className="secondary" onClick={() => patch(r.id, { done: false })}>Reopen</button>}
      <button className="secondary" onClick={() => remove(r.id)} aria-label="Delete"><Trash2 size={14} /></button>
    </div>
  );
  return (
    <Panel title="Flags & reminders" sub={`${open.length} open · only you can see these`}>
      <form className="row" onSubmit={add} style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Remind me to…" maxLength={200} aria-label="Reminder text" />
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Reminder time" />
        <button className="primary" disabled={!title.trim() || !when}>Add reminder</button>
      </form>
      {!items.length && <EmptyState title="Nothing flagged yet" text="Flag a ticket or set a reminder from the ticket panel." />}
      {open.map(row)}
      {done.length > 0 && <><h4 style={{ marginTop: 16 }}>Done</h4>{done.map(row)}</>}
    </Panel>
  );
}
