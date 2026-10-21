import { useEffect, useState } from "react";
import { ClipboardCheck, Mail } from "lucide-react";
import Panel from "../components/ui/Panel";
import EmptyState from "../components/ui/EmptyState";
import { api } from "../api";

const localToday = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the user's timezone
const ymd = (v) => String(v).slice(0, 10);

export default function UpdatesPage({ notify, onRefresh }) {
  const [history, setHistory] = useState([]);
  const [date, setDate] = useState(localToday());
  const [form, setForm] = useState({ yesterday: "", today: "", blockers: "" });
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/updates/mine").then((r) => setHistory(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  // Prefill when an update already exists for the chosen day (posting again edits it).
  useEffect(() => {
    const ex = history.find((h) => ymd(h.date) === date);
    setForm(ex ? { yesterday: ex.yesterday, today: ex.today, blockers: ex.blockers || "" } : { yesterday: "", today: "", blockers: "" });
  }, [date, history]);

  const editing = history.some((h) => ymd(h.date) === date);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/updates", { date, ...form });
      notify(editing ? "Update edited" : "Update posted");
      await load();
      onRefresh?.();
    } catch (err) {
      notify(err.response?.data?.error || "Could not post update", "error");
    } finally { setSaving(false); }
  };

  return (
    <div className="two-col">
      <Panel title={editing ? "Edit your update" : "Today’s update"} sub="Visible to admins in the admin console and activity log. For notes only you can see, use My notes.">
        <form className="update-form" onSubmit={submit}>
          <div className="field"><label htmlFor="u-date">Date</label><input id="u-date" type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} required /></div>
          <div className="field"><label htmlFor="u-y">What did you complete? <i>*</i></label><textarea id="u-y" value={form.yesterday} onChange={set("yesterday")} required minLength={2} rows={4} /></div>
          <div className="field"><label htmlFor="u-t">What will you work on next? <i>*</i></label><textarea id="u-t" value={form.today} onChange={set("today")} required minLength={2} rows={4} /></div>
          <div className="field"><label htmlFor="u-b">Blockers (optional)</label><textarea id="u-b" value={form.blockers} onChange={set("blockers")} rows={2} /></div>
          <button className="primary" disabled={saving}><Mail size={14} /> {saving ? "Saving…" : editing ? "Save changes" : "Post update"}</button>
        </form>
      </Panel>
      <Panel title="Your recent updates" sub="Last 30 days of your own history">
        {history.map((h) => (
          <div className="update-row" key={h.id} onClick={() => setDate(ymd(h.date))}>
            <b>{new Date(h.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</b>
            <p>{h.today}</p>
            {h.blockers && <small className="overdue">Blocker: {h.blockers}</small>}
          </div>
        ))}
        {!history.length && <EmptyState icon={<ClipboardCheck />} title="No updates yet" text="Post your first daily update." />}
      </Panel>
    </div>
  );
}
