import { useCallback, useEffect, useState } from "react";
import { X, Megaphone } from "lucide-react";
import Avatar from "../ui/Avatar";
import { api } from "../../api";

export default function ProjectUpdatesModal({ project, canPost, onClose, notify }) {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/projects/${project.id}/updates`).then((r) => setItems(r.data)).catch(() => setItems([])), [project.id]);
  useEffect(() => { load(); }, [load]);

  const post = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post(`/projects/${project.id}/updates`, form);
      notify("Update posted — the client has been notified");
      setForm({ title: "", body: "" }); load();
    } catch (x) { notify(x.response?.data?.error || "Could not post update", "error"); } finally { setBusy(false); }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head"><span><small>PROJECT UPDATES</small><h2>{project.name}</h2></span><button type="button" onClick={onClose}><X /></button></div>
        <div className="modal-body">
          {canPost && (
            <form className="comment-form" onSubmit={post}>
              <div className="field"><label htmlFor="pu-title">Headline</label><input id="pu-title" required minLength={2} maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Homepage design approved, build started" /></div>
              <div className="field"><label htmlFor="pu-body">What’s new (the client sees this)</label><textarea id="pu-body" required minLength={2} rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
              <button className="primary" disabled={busy}><Megaphone size={16} /> Post to client</button>
            </form>
          )}
          {items === null && <small className="muted">Loading…</small>}
          {items?.map((u) => (
            <div className="comment" key={u.id}>
              <span className="row-head"><Avatar name={u.author.name || u.author.email} /><b>{u.title}</b></span>
              <small>{u.author.name || u.author.email} · {new Date(u.createdAt).toLocaleString()}</small>
              <p>{u.body}</p>
            </div>
          ))}
          {items && !items.length && <small className="muted">No updates posted yet.</small>}
        </div>
      </div>
    </div>
  );
}
