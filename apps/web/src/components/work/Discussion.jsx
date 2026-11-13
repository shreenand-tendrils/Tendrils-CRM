import { useCallback, useEffect, useState } from "react";
import { Paperclip, Send, Trash2, UploadCloud, MessageSquare, Files } from "lucide-react";
import { api } from "../../api";
import { ACCEPT, uploadFile } from "../../lib/files";
import PasteTextarea, { imageIds } from "../ui/PasteTextarea";
import RichText from "../ui/RichText";
import Avatar from "../ui/Avatar";
import FileRow from "../ui/FileRow";
import { fmtDate, fmtDateTime } from "../../lib/dates";

const when = (d) => fmtDateTime(d);
const MAX_DRAFT = 10;

/**
 * Comments and files in one place, for tickets and tasks.
 * - "Files" shows the record's own files and, separately, the files people sent inside comments.
 * - The composer takes text, pasted screenshots, and files from the device (button, drag and drop, or paste).
 */
export default function Discussion({ kind, id, me, staff = false, canUpload = true, canComment = true, canModerate = false, onChanged, onCount, notify, refreshKey }) {
  const base = kind === "ticket" ? `/tickets/${id}` : `/tasks/${id}`;
  const target = kind === "ticket" ? { ticketId: id } : { taskId: id };
  const noun = kind === "ticket" ? "ticket" : "task";
  const [comments, setComments] = useState(null);
  const [files, setFiles] = useState([]);
  const [view, setView] = useState("comments");
  const [text, setText] = useState("");
  const [chips, setChips] = useState([]); // files chosen for the comment being written
  const [visibility, setVisibility] = useState("CLIENT");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const fail = (m) => { setErr(m); notify?.(m, "error"); };

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([
      api.get(`${base}/comments`).then((r) => r.data).catch(() => []),
      api.get(`${base}/attachments`).then((r) => r.data).catch(() => []),
    ]);
    setComments(c); setFiles(f);
  }, [base]);
  useEffect(() => { setComments(null); setChips([]); setText(""); setErr(""); load(); }, [load, refreshKey]);

  const commentFiles = (comments || []).flatMap((c) => (c.attachments || []).map((a) => ({ ...a, by: c.author?.name || c.author?.email, at: c.createdAt })));
  useEffect(() => { if (comments) onCount?.({ comments: comments.length, files: files.length + commentFiles.length }); }, [comments, files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- files for the comment being written ----
  const addDraft = async (list) => {
    setErr("");
    for (const f of Array.from(list || [])) {
      if (chips.length >= MAX_DRAFT) { fail(`You can attach up to ${MAX_DRAFT} files to one comment.`); break; }
      const tmp = `tmp-${Date.now()}-${Math.random()}`;
      setChips((c) => [...c, { id: tmp, originalName: f.name, size: f.size, mimeType: f.type, busy: true }]);
      try {
        const up = await uploadFile(f, target, { draft: true });
        setChips((c) => c.map((x) => (x.id === tmp ? { ...up, busy: false } : x)));
      } catch (e) {
        setChips((c) => c.filter((x) => x.id !== tmp));
        fail(e.response?.data?.error || `Could not attach ${f.name}`);
      }
    }
  };
  const dropChip = async (c) => {
    setChips((x) => x.filter((y) => y.id !== c.id));
    try { await api.delete(`/files/${c.id}`); } catch { /* an unsent draft: nothing else to clean up */ }
  };
  const pick = (e) => { const list = e.target.files; e.target.value = ""; addDraft(list); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (canComment && e.dataTransfer?.files?.length) addDraft(e.dataTransfer.files); };

  const send = async () => {
    const body = text.trim();
    if ((!body && !chips.length) || busy || chips.some((c) => c.busy)) return;
    setBusy(true); setErr("");
    try {
      await api.post(`${base}/comments`, { body, ...(kind === "ticket" ? { visibility: staff ? visibility : "CLIENT" } : {}), attachmentIds: chips.map((c) => c.id) });
      setText(""); setChips([]);
      await load(); onChanged?.();
    } catch (e) { fail(e.response?.data?.error || "Could not post the comment"); }
    finally { setBusy(false); }
  };
  const removeComment = async (c) => {
    try { await api.delete(`${base}/comments/${c.id}`); await load(); onChanged?.(); }
    catch (e) { fail(e.response?.data?.error || "Could not delete the comment"); }
  };

  // ---- the record's own files (not tied to a comment) ----
  const addOwnList = async (list) => {
    for (const f of Array.from(list || [])) {
      try { await uploadFile(f, target); notify?.(`${f.name} uploaded`); }
      catch (er) { fail(er.response?.data?.error || `Could not upload ${f.name}`); }
    }
    await load(); onChanged?.();
  };
  const addOwn = (e) => { const list = e.target.files; e.target.value = ""; addOwnList(list); };
  const dropOwn = (e) => { e.preventDefault(); setDrag(false); if (canUpload && e.dataTransfer?.files?.length) addOwnList(e.dataTransfer.files); };

  if (!comments) return <p className="hint">Loading…</p>;
  const mine = (c) => c.authorId === me.user?.id;
  const newestFirst = [...comments].reverse();
  const nFiles = files.length + commentFiles.length;

  const composer = canComment ? (
    <div className={`composer${drag ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      <PasteTextarea
        value={text} rows={2} onChange={setText} target={target} aria-label="Comment"
        placeholder="Write a comment… paste a screenshot or drop files here"
        onOtherFile={(f) => addDraft([f])} onError={fail}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
      />
      {chips.length > 0 && <div className="composer-chips">{chips.map((c) => <FileRow key={c.id} file={c} compact busy={c.busy} onRemove={dropChip} />)}</div>}
      {err && <small className="hint file-err" role="alert">{err}</small>}
      <div className="composer-bar">
        <label className="btn-soft sm" title="Attach files from your device"><Paperclip size={15} /> Attach<input type="file" multiple accept={ACCEPT} onChange={pick} hidden /></label>
        {kind === "ticket" && staff && <select value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Comment visibility"><option value="CLIENT">Visible to client</option><option value="INTERNAL">Internal note</option></select>}
        <small className="hint composer-hint">Ctrl+Enter to send{kind === "task" ? " · only your team sees task comments" : ""}</small>
        <button type="button" className="primary" disabled={busy || chips.some((c) => c.busy) || (!text.trim() && !chips.length)} onClick={send}><Send size={14} /> {busy ? "Sending…" : "Comment"}</button>
      </div>
    </div>
  ) : <small className="hint">You can read comments but not post.</small>;

  return (
    <div className="disc">
      <div className="seg disc-switch" role="tablist" aria-label="Comments or files">
        <button type="button" role="tab" aria-selected={view === "comments"} className={view === "comments" ? "on" : ""} onClick={() => setView("comments")}><MessageSquare size={15} /> Comments <em>{comments.length}</em></button>
        <button type="button" role="tab" aria-selected={view === "files"} className={view === "files" ? "on" : ""} onClick={() => setView("files")}><Files size={15} /> Files <em>{nFiles}</em></button>
      </div>

      {view === "comments" && (
        <>
          {composer}
          <div className="disc-thread">
            {!comments.length ? <p className="disc-empty">No comments yet. Ask a question or leave an update.</p> : <small className="disc-sort">Newest first</small>}
            {newestFirst.map((c) => {
              const inText = new Set(imageIds(c.body));
              const extra = (c.attachments || []).filter((a) => !inText.has(a.id)); // pasted screenshots already show inside the text
              return (
                <div className={`comment${c.visibility === "INTERNAL" ? " internal" : ""}${mine(c) ? " own" : ""}`} key={c.id}>
                  <div className="comment-head">
                    <Avatar name={c.author?.name || c.author?.email} />
                    <b>{c.author?.name || c.author?.email}</b>
                    {c.visibility === "INTERNAL" && <em className="note-pill">Internal note</em>}
                    <small title={fmtDateTime(c.createdAt)}>{when(c.createdAt)}</small>
                    {kind === "task" && (mine(c) || canModerate) && <button type="button" className="btn-soft sm icon danger cm-del" onClick={() => removeComment(c)} aria-label="Delete comment" title="Delete comment"><Trash2 size={13} /></button>}
                  </div>
                  {c.body && <RichText text={c.body} canDelete={mine(c) || canModerate} />}
                  {extra.length > 0 && <div className="cm-files">{extra.map((a) => <FileRow key={a.id} file={a} compact sub={`${a.mimeType?.split("/")[1]?.toUpperCase() || "FILE"} · sent with this comment`} />)}</div>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === "files" && (
        <div className="disc-files">
          {canUpload && (
            <label className={`disc-drop${drag ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={dropOwn}>
              <UploadCloud size={22} />
              <span><b>Add files to this {noun}</b><small>Click to choose, or drop files here</small></span>
              <input type="file" multiple accept={ACCEPT} onChange={addOwn} hidden />
            </label>
          )}
          <section className="disc-group">
            <h5>On the {noun} <em>{files.length}</em></h5>
            {files.length ? files.map((f) => <FileRow key={f.id} file={f} sub={`Added ${fmtDate(f.createdAt)}`} />) : <p className="disc-empty">Nothing attached to the {noun} itself yet.</p>}
          </section>
          <section className="disc-group">
            <h5>Sent in comments <em>{commentFiles.length}</em></h5>
            {commentFiles.length ? commentFiles.map((f) => <FileRow key={f.id} file={f} sub={`${f.by || "Someone"} · ${when(f.at)}`} />) : <p className="disc-empty">Files sent with a comment show up here.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
