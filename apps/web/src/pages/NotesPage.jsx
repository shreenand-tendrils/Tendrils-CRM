import { useEffect, useState } from "react";
import { Lock, Pencil, Trash2 } from "lucide-react";
import Panel from "../components/ui/Panel";
import EmptyState from "../components/ui/EmptyState";
import { api } from "../api";

const localToday = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the user's timezone
const ymd = (v) => String(v).slice(0, 10);
const blank = () => ({ id: null, date: localToday(), title: "", body: "" });

// Personal notes: only the author can see them. Not emailed, no notification, not in the activity log.
export default function NotesPage({ notify }) {
  const [notes, setNotes] = useState([]);
  const [form, setForm] = useState(blank());
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = (query = q) => api.get("/notes/mine", { params: query ? { q: query } : {} })
    .then((r) => setNotes(r.data)).catch(() => notify?.("Could not load your notes", "error")).finally(() => setLoaded(true));
  useEffect(() => { const t = setTimeout(() => load(q), 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { date: form.date, title: form.title, body: form.body };
      if (form.id) await api.patch(`/notes/${form.id}`, body); else await api.post("/notes", body);
      notify?.(form.id ? "Note updated (private)" : "Note saved (private)");
      setForm(blank());
      await load();
    } catch (err) {
      notify?.(err.response?.data?.error || "Could not save the note", "error");
    } finally { setSaving(false); }
  };

  const remove = async (n) => {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    try { await api.delete(`/notes/${n.id}`); if (form.id === n.id) setForm(blank()); await load(); notify?.("Note deleted"); }
    catch { notify?.("Could not delete the note", "error"); }
  };

  return (
    <div className="two-col">
      <Panel title={form.id ? "Edit note" : "New note"} sub="Only you can see your notes">
        <p className="hint"><Lock size={13} style={{ verticalAlign: -2 }} /> Private to you. Not emailed, no notifications, not in the activity log, and admins or managers cannot open them.</p>
        <form className="update-form" onSubmit={save}>
          <div className="field"><label htmlFor="n-date">Date</label><input id="n-date" type="date" value={form.date} max={localToday()} onChange={set("date")} required /></div>
          <div className="field"><label htmlFor="n-title">Title (optional)</label><input id="n-title" value={form.title} onChange={set("title")} maxLength={120} /></div>
          <div className="field"><label htmlFor="n-body">Note <i>*</i></label><textarea id="n-body" value={form.body} onChange={set("body")} required rows={8} maxLength={10000} placeholder="What you did, what you learned, reminders for yourself…" /></div>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" disabled={saving}>{saving ? "Saving…" : form.id ? "Save changes" : "Save note"}</button>
            {form.id && <button type="button" className="secondary" onClick={() => setForm(blank())}>Cancel</button>}
          </div>
        </form>
      </Panel>
      <Panel title="My notes" sub={`${notes.length} note${notes.length === 1 ? "" : "s"}${q ? " found" : ""}`}>
        <div className="field"><input aria-label="Search your notes" placeholder="Search your notes" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {notes.map((n) => (
          <div className="update-row" key={n.id}>
            <b>{new Date(n.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}{n.title ? ` — ${n.title}` : ""}</b>
            <p style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
            <div className="row" style={{ gap: 8 }}>
              <button className="secondary" onClick={() => setForm({ id: n.id, date: ymd(n.date), title: n.title || "", body: n.body })}><Pencil size={13} /> Edit</button>
              <button className="secondary" onClick={() => remove(n)}><Trash2 size={13} /> Delete</button>
            </div>
          </div>
        ))}
        {loaded && !notes.length && <EmptyState icon={<Lock />} title={q ? "No matching notes" : "No notes yet"} text={q ? "Try a different search." : "Write your first private note."} />}
      </Panel>
    </div>
  );
}
