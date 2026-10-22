import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { api } from "../../api";
import RichText from "../ui/RichText";
import { clipboardFiles, appendLine, uploadInline, isImage, IMG_MARK } from "../../lib/paste";

const ago = (d) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// Team talk on a task. Enter = new line, Ctrl/Cmd+Enter = send, paste an image or PDF to attach it.
export default function TaskComments({ task, me, canComment, onChanged, notify }) {
  const [items, setItems] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const load = useCallback(() => api.get(`/tasks/${task.id}/comments`).then((r) => setItems(r.data)).catch(() => setItems([])), [task.id]);
  useEffect(() => { setItems(null); load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "nearest" }); }, [items?.length]);

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await api.post(`/tasks/${task.id}/comments`, { body: text.trim() }); setText(""); await load(); onChanged?.(); }
    catch (e) { notify?.(e.response?.data?.error || "Could not post the comment", "error"); }
    finally { setBusy(false); }
  };
  const remove = async (c) => {
    try { await api.delete(`/tasks/${task.id}/comments/${c.id}`); await load(); onChanged?.(); }
    catch (e) { notify?.(e.response?.data?.error || "Could not delete", "error"); }
  };
  // Pasted images appear inside the comment (not in Files); PDFs are attached as files.
  const paste = async (e) => {
    const files = clipboardFiles(e);
    if (!files.length) return;
    e.preventDefault();
    try {
      const marks = [];
      for (const f of files) {
        if (isImage(f)) marks.push(IMG_MARK((await uploadInline(f, { taskId: task.id })).id));
        else { const fd = new FormData(); fd.append("file", f); fd.append("taskId", task.id); await api.post("/files", fd); onChanged?.(); }
      }
      if (marks.length) setText((v) => appendLine(v, marks.join("\n")));
    } catch (err) { notify?.(err.response?.data?.error || "Could not paste the image", "error"); }
  };

  if (!items) return <p className="hint">Loading comments…</p>;
  return (
    <div className="task-comments">
      {!items.length && <p className="hint">No comments yet. Ask a question or leave an update for the team.</p>}
      {items.map((c) => (
        <div className="comment" key={c.id}>
          <b>{c.author?.name || c.author?.email}</b>
          <small title={new Date(c.createdAt).toLocaleString()}> · {ago(c.createdAt)}</small>
          {(c.authorId === me.user.id) && <button type="button" className="secondary" style={{ float: "right" }} onClick={() => remove(c)} aria-label="Delete comment"><Trash2 size={13} /></button>}
          <RichText text={c.body} canDelete={c.authorId === me.user.id} />
        </div>
      ))}
      <div ref={endRef} />
      {canComment ? (
        <div className="comment-form">
          <textarea value={text} rows={3} aria-label="Task comment" placeholder="Write a comment… (Ctrl+Enter to send, paste an image or PDF to attach)"
            onChange={(e) => setText(e.target.value)} onPaste={paste}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
          <div className="row"><small className="hint">Only your team sees task comments. Assignees are notified.</small><button className="primary" disabled={!text.trim() || busy} onClick={send}><Send size={14} /> {busy ? "Sending…" : "Comment"}</button></div>
        </div>
      ) : <small className="hint">You can read comments but not post.</small>}
    </div>
  );
}
