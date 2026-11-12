import { useCallback, useEffect, useState } from "react";
import { Flag, Trash2, Check, RotateCcw, Plus } from "lucide-react";
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
  const row = (r) => {
    const overdue = !r.doneAt && r.remindAt && new Date(r.remindAt) < new Date();
    return (
      <div className={`rem-row${overdue ? " overdue" : ""}${r.doneAt ? " done" : ""}`} key={r.id}>
        <span className={`rem-flag${r.flagged ? " on" : ""}`}><Flag size={17} /></span>
        <div className="rem-body">
          <b>{r.title}</b>
          <small>
            {r.remindAt ? `Due ${new Date(r.remindAt).toLocaleString()}` : "Flagged"}
            {overdue && <i className="rem-tag">Overdue</i>}
            {r.ticket && <> · <a href="#open" onClick={(e) => { e.preventDefault(); onOpenTicket?.(r.ticket); }}>{r.ticket.key}</a></>}
          </small>
        </div>
        <div className="rem-actions">
          {!r.doneAt && <button type="button" className="btn-soft sm ok" onClick={() => patch(r.id, { done: true })} aria-label="Mark done"><Check size={15} /> Done</button>}
          {r.doneAt && <button type="button" className="btn-soft sm" onClick={() => patch(r.id, { done: false })}><RotateCcw size={14} /> Reopen</button>}
          <button type="button" className="btn-soft sm icon danger" onClick={() => remove(r.id)} aria-label="Delete" title="Delete"><Trash2 size={15} /></button>
        </div>
      </div>
    );
  };
  return (
    <Panel title="Flags & reminders" sub={`${open.length} open · only you can see these`}>
      <form className="rem-form" onSubmit={add}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Remind me to…" maxLength={200} aria-label="Reminder text" />
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Reminder time" />
        <button className="primary" disabled={!title.trim() || !when}><Plus size={16} /> Add reminder</button>
      </form>
      {!items.length && <EmptyState title="Nothing flagged yet" text="Flag a ticket or set a reminder from the ticket panel." />}
      {open.length > 0 && <div className="rem-section"><h4>Open · {open.length}</h4>{open.map(row)}</div>}
      {done.length > 0 && <div className="rem-section"><h4>Done · {done.length}</h4>{done.map(row)}</div>}
    </Panel>
  );
}
