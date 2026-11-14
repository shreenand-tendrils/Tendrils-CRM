import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip, Send, Trash2, UploadCloud, MessageSquare, Files } from "lucide-react";
import { api } from "../../api";
import { ACCEPT, uploadFile } from "../../lib/files";
import PasteTextarea, { imageIds, textOnly, withImages } from "../ui/PasteTextarea";
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
export default function Discussion({ kind, id, me, users = [], staff = false, canUpload = true, canComment = true, canModerate = false, onChanged, onCount, notify, refreshKey }) {
  const base = kind === "ticket" ? `/tickets/${id}` : `/tasks/${id}`;
  const target = kind === "ticket" ? { ticketId: id } : { taskId: id };
  const noun = kind === "ticket" ? "ticket" : "task";
  const [comments, setComments] = useState(null);
  const [files, setFiles] = useState([]);
  const [view, setView] = useState("comments");
  const [text, setText] = useState("");
  const [chips, setChips] = useState([]); // files chosen for the comment being written
  const [mentionMap, setMentionMap] = useState({});
  const [visibility, setVisibility] = useState("CLIENT");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const [ownUploading, setOwnUploading] = useState(false);
  const commentPicker = useRef(null);
  const ownPicker = useRef(null);
  const composerRef = useRef(null);
  const [mentionPosition, setMentionPosition] = useState(null);
  const fail = (m) => { setErr(m); notify?.(m, "error"); };

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([
      api.get(`${base}/comments`).then((r) => r.data).catch(() => []),
      api.get(`${base}/attachments`).then((r) => r.data).catch(() => []),
    ]);
    setComments(c); setFiles(f);
  }, [base]);
  useEffect(() => { setComments(null); setChips([]); setText(""); setMentionMap({}); setErr(""); load(); }, [load, refreshKey]);

  const commentFiles = (comments || []).flatMap((c) => (c.attachments || []).map((a) => ({ ...a, by: c.author?.name || c.author?.email, at: c.createdAt })));
  useEffect(() => { if (comments) onCount?.({ comments: comments.length, files: files.length + commentFiles.length }); }, [comments, files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- files for the comment being written ----
  const addDraft = async (list) => {
    setErr("");
    let count = chips.length;
    for (const f of Array.from(list || [])) {
      if (count >= MAX_DRAFT) { fail(`You can attach up to ${MAX_DRAFT} files to one comment.`); break; }
      count += 1;
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
  const pick = (e) => {
    const selected = Array.from(e.currentTarget.files || []);
    e.currentTarget.value = "";
    if (selected.length) addDraft(selected);
  };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (canComment && e.dataTransfer?.files?.length) addDraft(e.dataTransfer.files); };

  const send = async () => {
    const body = text.trim();
    if ((!body && !chips.length) || busy || chips.some((c) => c.busy)) return;
    setBusy(true); setErr("");
    try {
      await api.post(`${base}/comments`, { body, ...(kind === "ticket" ? { visibility: staff ? visibility : "CLIENT", mentionIds: mentionedIds } : {}), attachmentIds: chips.map((c) => c.id) });
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
    const selected = Array.from(list || []);
    if (!selected.length) return;
    setOwnUploading(true); setErr("");
    let uploaded = 0;
    try {
      for (const f of selected) {
        try { await uploadFile(f, target); uploaded += 1; }
        catch (er) { fail(er.response?.data?.error || `Could not upload ${f.name}`); }
      }
      await load();
      if (uploaded) notify?.(`${uploaded} file${uploaded === 1 ? "" : "s"} uploaded`);
      onChanged?.();
    } finally { setOwnUploading(false); }
  };
  const addOwn = (e) => {
    const selected = Array.from(e.currentTarget.files || []);
    e.currentTarget.value = "";
    if (selected.length) addOwnList(selected);
  };
  const dropOwn = (e) => { e.preventDefault(); setDrag(false); if (canUpload && e.dataTransfer?.files?.length) addOwnList(e.dataTransfer.files); };

  const plainText = textOnly(text);
  const mentionQueryMatch = kind === "ticket" ? /(?:^|\s)@([\w.-]*)$/.exec(plainText) : null;
  const mentionQuery = mentionQueryMatch ? mentionQueryMatch[1].toLowerCase() : null;
  const displayName = (u) => u.name || u.email || "Teammate";
  const mentionSuggestions = mentionQuery === null ? [] : users
    .filter((u) => u.id !== me.user?.id && (displayName(u).toLowerCase().includes(mentionQuery) || (u.email || "").toLowerCase().includes(mentionQuery)))
    .slice(0, 6);
  useEffect(() => {
    if (!mentionSuggestions.length || !composerRef.current) { setMentionPosition(null); return; }
    const place = () => {
      const rect = composerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMentionPosition({ left: Math.max(8, rect.left + 10), top: rect.top >= 246 ? rect.top - 238 : Math.min(window.innerHeight - 238, rect.bottom + 6), width: Math.max(180, Math.min(340, rect.width - 20)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [mentionSuggestions.length, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateText = (next) => setText(next);
  const pickMention = (u) => {
    const token = `@${displayName(u)}`;
    setMentionMap((cur) => ({ ...cur, [token]: u.id }));
    setText((cur) => withImages(textOnly(cur).replace(/@([\w.-]*)$/, `${token} `), imageIds(cur)));
  };
  const mentionedIds = [...new Set(Object.entries(mentionMap)
    .filter(([token]) => plainText.includes(token))
    .map(([, userId]) => userId))];

  if (!comments) return <p className="hint">Loading…</p>;
  const mine = (c) => c.authorId === me.user?.id;
  const newestFirst = [...comments].reverse();
  const nFiles = files.length + commentFiles.length;

  const composer = canComment ? (
    <div ref={composerRef} className={`composer${drag ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      <PasteTextarea
        value={text} rows={2} onChange={updateText} target={target} aria-label="Comment"
        placeholder="Write a comment… paste a screenshot or drop files here"
        onOtherFile={(f) => addDraft([f])} onError={fail}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
      />
      {mentionSuggestions.length > 0 && mentionPosition && createPortal(
        <div className="disc-mention-menu disc-mention-menu-portal" role="listbox" aria-label="Mention someone" style={mentionPosition}>
          {mentionSuggestions.map((u) => (
            <button key={u.id} type="button" role="option" onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}>
              <span className="disc-mention-avatar">{displayName(u).slice(0, 1).toUpperCase()}</span>
              <span><b>{displayName(u)}</b><small>{u.email}</small></span>
            </button>
          ))}
        </div>, document.body
      )}
      {chips.length > 0 && <div className="composer-chips">{chips.map((c) => <FileRow key={c.id} file={c} compact busy={c.busy} onRemove={dropChip} />)}</div>}
      {err && <small className="hint file-err" role="alert">{err}</small>}
      <div className="composer-bar">
        <button type="button" className="btn-soft sm" title="Attach files from your device" onClick={() => commentPicker.current?.click()}><Paperclip size={15} /> Attach</button>
        <input ref={commentPicker} type="file" multiple accept={ACCEPT} onChange={pick} hidden />
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
            <>
              <div className={`disc-drop${drag ? " over" : ""}`} role="button" tabIndex={0}
                aria-disabled={ownUploading} onClick={() => !ownUploading && ownPicker.current?.click()}
                onKeyDown={(e) => { if (!ownUploading && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ownPicker.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={dropOwn}>
                <UploadCloud size={22} />
                <span><b>{ownUploading ? "Uploading…" : `Add files to this ${noun}`}</b><small>Click to choose, or drop files here</small></span>
              </div>
              <input ref={ownPicker} type="file" multiple accept={ACCEPT} onChange={addOwn} hidden />
              {err && <small className="hint file-err" role="alert">{err}</small>}
            </>
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
