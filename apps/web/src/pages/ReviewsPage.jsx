import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Plus, Link2, FileText, FileSpreadsheet, Image as ImageIcon, ExternalLink, Download, Eye, Check, MessageSquareWarning, Send, Bell,
  Undo2, RotateCcw, Upload, X, Search, Clock, Users, ChevronDown, ChevronRight, Paperclip, CheckCircle2, CircleDashed, History,
} from "lucide-react";
import { api } from "../api";
import { can } from "../lib/rbac";
import { fmtDate, fmtDateTime } from "../lib/dates";
import { fmtSize, uploadErrorText, checkUploadSize } from "../lib/files";
import Avatar from "../components/ui/Avatar";
import EmptyState from "../components/ui/EmptyState";
import Window from "../components/ui/Window";
import "../styles/reviews.css";

const ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.xlsm,.ppt,.pptx,.csv,.txt,.md,.zip,.heic,.fig,.mp4,.mov";
const STATUS = {
  IN_REVIEW: { label: "In review", cls: "in" },
  APPROVED: { label: "Approved", cls: "ok" },
  CHANGES_REQUESTED: { label: "Changes requested", cls: "chg" },
  CANCELLED: { label: "Withdrawn", cls: "off" },
};
const DECISION = { PENDING: { label: "Waiting", cls: "wait", Icon: CircleDashed }, APPROVED: { label: "Approved", cls: "ok", Icon: CheckCircle2 }, CHANGES_REQUESTED: { label: "Changes", cls: "chg", Icon: MessageSquareWarning } };
const err = (e, fb) => e?.response?.data?.error || fb;
const nameOf = (u) => u?.name || u?.email || "Someone";
const isLate = (r) => r.dueDate && ["IN_REVIEW", "CHANGES_REQUESTED"].includes(r.status) && new Date(r.dueDate).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);
const fileIcon = (i) => (/sheet|excel|csv/.test(i.mimeType || "") || /\.(xlsx?|xlsm|csv)$/i.test(i.originalName || "") ? FileSpreadsheet : /^image\//.test(i.mimeType || "") ? ImageIcon : FileText);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

async function openItemFile(reviewId, item, { download = false } = {}) {
  const tab = !download && /^(image\/|application\/pdf)/.test(item.mimeType || "") ? window.open("", "_blank") : null;
  try {
    const r = await api.get(`/reviews/${reviewId}/items/${item.id}/file`, { responseType: "blob" });
    const url = URL.createObjectURL(r.data);
    if (tab) { tab.location.href = url; } else { const a = document.createElement("a"); a.href = url; a.download = item.originalName || item.title; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { tab?.close(); throw e; }
}

/* ---------- adding links + files (used by the new-review window and the "add / new version" box) ---------- */
function Collector({ links, setLinks, files, setFiles, notify, compact = false }) {
  const [draft, setDraft] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const addLinks = (text) => {
    const found = String(text).split(/[\s,]+/).filter((x) => /^(https?:\/\/|www\.)\S+/i.test(x));
    if (!found.length) return false;
    setLinks((cur) => [...cur, ...found.filter((u) => !cur.some((c) => c.url === u)).map((url) => ({ url, title: "" }))]);
    return true;
  };
  const addFiles = (list) => {
    const next = [];
    for (const f of Array.from(list || [])) { const bad = checkUploadSize(f); if (bad) notify?.(bad, "error"); else next.push(f); }
    if (next.length) setFiles((cur) => [...cur, ...next].slice(0, 12));
  };
  const commit = (silent = false) => {
    const t = draft.trim();
    if (!t) return;
    if (!addLinks(t)) {
      if (/^\S+\.\S+$/.test(t)) setLinks((c) => (c.some((x) => x.url === t) ? c : [...c, { url: t, title: "" }]));
      else { if (!silent) notify?.("That does not look like a link", "error"); return; }
    }
    setDraft("");
  };
  return (
    <div className={"rv-collect" + (compact ? " compact" : "")}>
      <div className="rv-linkbox">
        <Link2 size={17} />
        <input value={draft} placeholder="Paste a link (Figma, Drive, Sheet, site…) and press Enter" aria-label="Add a link"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/\s/.test(t.trim()) && addLinks(t)) { e.preventDefault(); } }}
          onBlur={() => commit(true)} />
        <button type="button" className="btn-soft sm" onClick={() => commit()} disabled={!draft.trim()}>Add</button>
      </div>
      <div className={"rv-drop" + (over ? " over" : "")} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        onPaste={(e) => addFiles(e.clipboardData.files)}>
        <Upload size={18} /> <span><b>Drop files here</b> or click to browse · screenshots, Excel, PDF, decks · up to 15 MB each</span>
        <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>
      {(links.length > 0 || files.length > 0) && (
        <ul className="rv-queue">
          {links.map((l, i) => (
            <li key={"l" + i}><Link2 size={15} /><input className="rv-q-title" value={l.title} placeholder={hostOf(l.url)} aria-label="Link title" onChange={(e) => setLinks((c) => c.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /><small>{hostOf(l.url)}</small><button type="button" aria-label="Remove" onClick={() => setLinks((c) => c.filter((_, j) => j !== i))}><X size={15} /></button></li>
          ))}
          {files.map((f, i) => (
            <li key={"f" + i}><Paperclip size={15} /><span className="rv-q-name">{f.name}</span><small>{fmtSize(f.size)}</small><button type="button" aria-label="Remove" onClick={() => setFiles((c) => c.filter((_, j) => j !== i))}><X size={15} /></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

const toForm = (fields, links, files) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") fd.append(k, typeof v === "string" ? v : JSON.stringify(v)); });
  fd.append("links", JSON.stringify(links.map((l) => ({ url: l.url, title: l.title }))));
  files.forEach((f) => fd.append("files", f));
  return fd;
};

/* ---------- new review ---------- */
function NewReviewWindow({ me, onClose, onCreated, notify }) {
  const [people, setPeople] = useState({ users: [], teams: [] });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [links, setLinks] = useState([]);
  const [files, setFiles] = useState([]);
  const [teamIds, setTeamIds] = useState([]);
  const [userIds, setUserIds] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/reviews/people").then((r) => setPeople(r.data)).catch(() => notify?.("Could not load teams and people", "error")); }, [notify]);

  const myId = me?.user?.id;
  const reviewerSet = useMemo(() => {
    const s = new Set(userIds);
    people.teams.filter((t) => teamIds.includes(t.id)).forEach((t) => t.userIds.forEach((id) => s.add(id)));
    s.delete(myId);
    return s;
  }, [people, teamIds, userIds, myId]);
  const shownUsers = people.users.filter((u) => u.id !== myId && (!q || nameOf(u).toLowerCase().includes(q.toLowerCase())));
  const toggle = (set, id) => set((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const today = new Date().toISOString().slice(0, 10);
  const ready = title.trim() && (links.length || files.length) && reviewerSet.size > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/reviews", toForm({ title: title.trim(), description: description.trim(), dueDate, teamIds, reviewerIds: userIds }, links, files));
      notify?.("Review sent. Reviewers were notified by email.");
      onCreated(data);
    } catch (x) { notify?.(files[0] && !x.response?.data?.error ? uploadErrorText(x, files[0]) : err(x, "Could not send the review"), "error"); } finally { setBusy(false); }
  };

  return (
    <Window label="New review" onClose={onClose} head={<div><h2 className="rv-win-title">Ask for a review</h2><small>Share links or files. Reviewers approve or ask for changes.</small></div>}>
      <form className="rv-new" onSubmit={submit}>
        <div className="rv-row2">
          <label className="rv-field"><span>What should they review?</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q4 catalog pricing sheet" maxLength={160} autoFocus required /></label>
          <label className="rv-field"><span>Due date <i>(optional)</i></span>
            <input type="date" min={today} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>
        <label className="rv-field"><span>Note for reviewers <i>(optional)</i></span>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What to focus on, what is already decided, anything they should know…" maxLength={4000} /></label>
        <div className="rv-field"><span>Links and files</span><Collector links={links} setLinks={setLinks} files={files} setFiles={setFiles} notify={notify} /></div>
        <div className="rv-field"><span>Who reviews? <i>Pick teams, people, or both</i></span>
          <div className="rv-chips">
            {people.teams.map((t) => (
              <button type="button" key={t.id} className={"rv-chip" + (teamIds.includes(t.id) ? " on" : "")} onClick={() => toggle(setTeamIds, t.id)}><Users size={14} /> {t.name} <small>{t.userIds.filter((id) => id !== myId).length}</small></button>
            ))}
            {!people.teams.length && <small className="muted">No teams yet. Pick people below.</small>}
          </div>
          <div className="rv-people">
            <div className="rv-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" /></div>
            <div className="rv-people-list">
              {shownUsers.map((u) => {
                const viaTeam = people.teams.some((t) => teamIds.includes(t.id) && t.userIds.includes(u.id));
                const on = userIds.includes(u.id) || viaTeam;
                return (
                  <label key={u.id} className={"rv-person" + (on ? " on" : "")}>
                    <input type="checkbox" checked={on} disabled={viaTeam} onChange={() => toggle(setUserIds, u.id)} />
                    <Avatar name={nameOf(u)} /><span className="rv-pname">{nameOf(u)}</span>{viaTeam && <small>via team</small>}
                  </label>
                );
              })}
              {!shownUsers.length && <small className="muted">No one matches.</small>}
            </div>
          </div>
        </div>
        <footer className="rv-new-foot">
          <small>{reviewerSet.size ? `${reviewerSet.size} reviewer${reviewerSet.size > 1 ? "s" : ""} will get an email and a notification.` : "Choose at least one reviewer."}</small>
          <div><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!ready || busy}><Send size={16} /> {busy ? "Sending…" : "Send for review"}</button></div>
        </footer>
      </form>
    </Window>
  );
}

/* ---------- one review ---------- */
function ItemCard({ reviewId, item, notify }) {
  const run = (opts) => openItemFile(reviewId, item, opts).catch((e) => notify?.(err(e, "Could not open the file"), "error"));
  if (item.kind === "LINK") {
    return (
      <a className="rv-item link" href={item.url} target="_blank" rel="noopener noreferrer">
        <span className="rv-ico"><Link2 size={18} /></span>
        <span className="rv-item-main"><b>{item.title}</b><small>{hostOf(item.url)}</small></span>
        <ExternalLink size={16} className="rv-go" />
      </a>
    );
  }
  const Icon = fileIcon(item);
  const previewable = /^(image\/|application\/pdf)/.test(item.mimeType || "");
  return (
    <div className="rv-item file">
      <span className="rv-ico file"><Icon size={18} /></span>
      <span className="rv-item-main"><b>{item.title}</b><small>{fmtSize(item.size)}</small></span>
      <span className="rv-item-actions">
        {previewable && <button type="button" className="btn-soft sm" onClick={() => run({})}><Eye size={14} /> Open</button>}
        <button type="button" className="btn-soft sm" onClick={() => run({ download: true })}><Download size={14} /> Download</button>
      </span>
    </div>
  );
}

function ReviewDetail({ id, me, notify, onChanged }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [adding, setAdding] = useState(false);
  const [links, setLinks] = useState([]);
  const [files, setFiles] = useState([]);
  const [asVersion, setAsVersion] = useState(true);
  const [versionNote, setVersionNote] = useState("");
  const logRef = useRef(null);

  const load = useCallback(() => api.get(`/reviews/${id}`).then((x) => { setR(x.data); return x.data; }).catch((e) => { notify?.(err(e, "Could not open this review"), "error"); setR(null); }), [id, notify]);
  useEffect(() => { setR(null); setNote(""); setComment(""); setAdding(false); setLinks([]); setFiles([]); load(); }, [load]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [r?.comments?.length]);

  const act = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try { const res = await fn(); if (res?.data?.id) setR(res.data); if (okMsg) notify?.(okMsg); onChanged?.(); return true; }
    catch (e) { notify?.(err(e, "That did not work"), "error"); return false; } finally { setBusy(false); }
  };
  if (!r) return <div className="rv-detail rv-empty"><small>Loading…</small></div>;

  const st = STATUS[r.status];
  const open = ["IN_REVIEW", "CHANGES_REQUESTED"].includes(r.status);
  const current = r.items.filter((i) => i.version === r.version);
  const older = r.items.filter((i) => i.version < r.version);
  const olderVersions = [...new Set(older.map((i) => i.version))].sort((a, b) => b - a);
  const canReview = r.isReviewer && r.status !== "CANCELLED";
  const pending = r.counts.pending;

  const decide = (decision) => act(() => api.post(`/reviews/${r.id}/decision`, { decision, note }), decision === "APPROVED" ? "Approved" : "Changes sent to the requester").then((ok) => ok && setNote(""));
  const sendComment = (e) => { e.preventDefault(); if (!comment.trim()) return; act(() => api.post(`/reviews/${r.id}/comments`, { body: comment.trim() })).then((ok) => ok && setComment("")); };
  const addItems = () => act(() => api.post(`/reviews/${r.id}/items`, toForm({ newVersion: String(asVersion), note: versionNote.trim() }, links, files)), asVersion ? "New version sent. Reviewers were notified." : "Added").then((ok) => { if (ok) { setAdding(false); setLinks([]); setFiles([]); setVersionNote(""); } });

  return (
    <div className="rv-detail">
      <header className="rv-d-head">
        <div className="rv-d-title">
          <h2>{r.title}</h2>
          <div className="rv-meta">
            <span className={"rv-status " + st.cls}>{st.label}</span>
            <span className="rv-v">v{r.version}</span>
            <span><Avatar name={nameOf(r.requester)} /> {r.isRequester ? "You" : nameOf(r.requester)} asked · {fmtDate(r.createdAt)}</span>
            {r.dueDate && <span className={"rv-due" + (isLate(r) ? " late" : "")}><Clock size={13} /> Due {fmtDate(r.dueDate)}{isLate(r) ? " · overdue" : ""}</span>}
          </div>
        </div>
        {r.isRequester && (
          <div className="rv-d-actions">
            {open && pending > 0 && <button className="btn-soft sm" disabled={busy} onClick={() => act(() => api.post(`/reviews/${r.id}/remind`).then(() => load()), `Reminder sent to ${pending} ${pending > 1 ? "people" : "person"}`)}><Bell size={14} /> Remind {pending}</button>}
            {r.status === "CANCELLED"
              ? <button className="btn-soft sm" disabled={busy} onClick={() => act(() => api.post(`/reviews/${r.id}/reopen`), "Reopened")}><RotateCcw size={14} /> Reopen</button>
              : <button className="btn-soft sm danger" disabled={busy} onClick={() => window.confirm("Withdraw this review? Reviewers will no longer be asked to decide.") && act(() => api.post(`/reviews/${r.id}/withdraw`), "Withdrawn")}><Undo2 size={14} /> Withdraw</button>}
          </div>
        )}
      </header>

      {r.description && <p className="rv-desc">{r.description}</p>}

      <section className="rv-sec">
        <div className="rv-sec-head"><h3>What to review <small>version {r.version}</small></h3>
          {r.isRequester && r.status !== "CANCELLED" && <button className="btn-soft sm" onClick={() => setAdding((v) => !v)}><Plus size={14} /> Add or upload new version</button>}</div>
        <div className="rv-items">{current.map((i) => <ItemCard key={i.id} reviewId={r.id} item={i} notify={notify} />)}{!current.length && <small className="muted">Nothing attached to this version.</small>}</div>
        {adding && (
          <div className="rv-add">
            <Collector links={links} setLinks={setLinks} files={files} setFiles={setFiles} notify={notify} compact />
            <label className="rv-check"><input type="checkbox" checked={asVersion} onChange={(e) => setAsVersion(e.target.checked)} /> <span><b>This is a new version</b> · resets every reviewer's decision and notifies them</span></label>
            {asVersion && <input className="rv-vnote" value={versionNote} onChange={(e) => setVersionNote(e.target.value)} placeholder="What changed? (shown to reviewers)" maxLength={1000} />}
            <div className="rv-add-foot"><button className="secondary" onClick={() => setAdding(false)}>Cancel</button><button className="primary" disabled={busy || (!links.length && !files.length)} onClick={addItems}><Send size={15} /> {asVersion ? `Send v${r.version + 1}` : "Add"}</button></div>
          </div>
        )}
        {older.length > 0 && (
          <div className="rv-old">
            <button type="button" className="rv-old-toggle" onClick={() => setShowOld((v) => !v)}>{showOld ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Earlier versions ({olderVersions.map((v) => "v" + v).join(", ")})</button>
            {showOld && olderVersions.map((v) => (<div key={v} className="rv-old-group"><h4>Version {v}</h4><div className="rv-items">{older.filter((i) => i.version === v).map((i) => <ItemCard key={i.id} reviewId={r.id} item={i} notify={notify} />)}</div></div>))}
          </div>
        )}
      </section>

      <section className="rv-sec">
        <div className="rv-sec-head"><h3>Reviewers <small>{r.counts.approved} of {r.counts.total} approved</small></h3></div>
        <div className="rv-progress" aria-hidden><i className="ok" style={{ width: `${(r.counts.approved / Math.max(1, r.counts.total)) * 100}%` }} /><i className="chg" style={{ width: `${(r.counts.changes / Math.max(1, r.counts.total)) * 100}%` }} /></div>
        {r.teams.length > 0 && <div className="rv-teams">{r.teams.map((t) => <span key={t.id} className="chip-link"><Users size={12} /> {t.name}</span>)}</div>}
        <ul className="rv-reviewers">
          {r.reviewers.map((x) => { const d = DECISION[x.decision]; return (
            <li key={x.userId}>
              <Avatar name={nameOf(x.user)} />
              <span className="rv-r-main"><b>{x.userId === me?.user?.id ? "You" : nameOf(x.user)}</b>{x.note && <small>“{x.note}”</small>}</span>
              <span className={"rv-dec " + d.cls}><d.Icon size={14} /> {d.label}</span>
            </li>); })}
        </ul>
      </section>

      {canReview && (
        <section className="rv-sec rv-decide">
          <h3>{r.myDecision && r.myDecision !== "PENDING" ? `You ${r.myDecision === "APPROVED" ? "approved" : "asked for changes"}. Change your mind?` : "Your decision"}</h3>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Comment (required when you ask for changes)" maxLength={2000} />
          <div className="rv-decide-btns">
            <button className="rv-approve" disabled={busy} onClick={() => decide("APPROVED")}><Check size={16} /> Approve</button>
            <button className="rv-changes" disabled={busy || !note.trim()} onClick={() => decide("CHANGES_REQUESTED")} title={!note.trim() ? "Write what to change first" : ""}><MessageSquareWarning size={16} /> Request changes</button>
          </div>
        </section>
      )}

      <section className="rv-sec">
        <div className="rv-sec-head"><h3><History size={15} /> Conversation</h3></div>
        <ul className="rv-log" ref={logRef}>
          {r.comments.map((c) => (
            <li key={c.id} className={"k-" + c.kind.toLowerCase()}>
              <Avatar name={nameOf(c.author)} />
              <div><p className="rv-log-head"><b>{c.author.id === me?.user?.id ? "You" : nameOf(c.author)}</b>
                {c.kind === "APPROVED" && <span className="rv-dec ok"><CheckCircle2 size={13} /> approved</span>}
                {c.kind === "CHANGES" && <span className="rv-dec chg"><MessageSquareWarning size={13} /> asked for changes</span>}
                {c.kind === "VERSION" && <span className="rv-v">v{c.version}</span>}
                <time>{fmtDateTime(c.createdAt)}</time></p>
                {c.body && c.kind !== "SYSTEM" && <p className="rv-log-body">{c.body}</p>}
                {c.kind === "SYSTEM" && <p className="rv-log-sys">{c.body}</p>}</div>
            </li>
          ))}
        </ul>
        <form className="rv-comment" onSubmit={sendComment}>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" maxLength={4000} aria-label="Comment" />
          <button className="primary" disabled={busy || !comment.trim()} aria-label="Send comment"><Send size={16} /></button>
        </form>
      </section>
    </div>
  );
}

/* ---------- page ---------- */
export default function ReviewsPage({ me, notify }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState("todo");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const openId = new URLSearchParams(loc.search).get("open");
  const isAdmin = can(me, "admin.view");

  const load = useCallback(() => api.get("/reviews").then((r) => setRows(r.data)).catch((e) => { notify?.(err(e, "Could not load reviews"), "error"); setRows([]); }), [notify]);
  useEffect(() => { load(); }, [load]);

  const live = (r) => ["IN_REVIEW", "CHANGES_REQUESTED"].includes(r.status);
  const groups = useMemo(() => {
    const all = rows || [];
    return {
      todo: all.filter((r) => r.myDecision === "PENDING" && live(r)),
      mine: all.filter((r) => r.isRequester),
      all,
    };
  }, [rows]);
  useEffect(() => { if (rows && tab === "todo" && !groups.todo.length && groups.mine.length) setTab("mine"); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (groups[tab] || []).filter((r) => !q || (r.title + " " + nameOf(r.requester)).toLowerCase().includes(q.toLowerCase()));
  const select = (id) => navigate(id ? `/reviews?open=${id}` : "/reviews", { replace: true });

  // Opened from a notification or email link for a review that is not in the current tab: show it anyway.
  useEffect(() => { if (openId && rows && !shown.some((r) => r.id === openId) && (rows || []).some((r) => r.id === openId)) setTab("all"); }, [openId, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = [["todo", "To review", groups.todo.length], ["mine", "Asked by me", groups.mine.length], ...(isAdmin ? [["all", "Everything", groups.all.length]] : [])];

  return (
    <div className={"rv-page" + (openId ? " has-open" : "")}>
      <aside className="rv-list">
        <div className="rv-list-head">
          <div className="rv-tabs" role="tablist">{tabs.map(([k, label, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}{n > 0 && <i>{n}</i>}</button>)}</div>
          {can(me, "review.request") && <button className="primary rv-new-btn" onClick={() => setShowNew(true)}><Plus size={16} /> New review</button>}
        </div>
        <div className="rv-search wide"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reviews" aria-label="Search reviews" /></div>
        <div className="rv-rows">
          {rows === null && <small className="muted pad">Loading…</small>}
          {rows && !shown.length && (
            <EmptyState icon={<Eye size={26} />} title={tab === "todo" ? "Nothing waiting for you" : "No reviews here yet"} text={tab === "todo" ? "When someone asks you to review something, it shows up here and in your email." : can(me, "review.request") ? "Use New review to share links or files for review." : "Reviews you are part of will appear here."} />
          )}
          {shown.map((r) => {
            const st = STATUS[r.status];
            return (
              <button key={r.id} className={"rv-row" + (openId === r.id ? " on" : "")} onClick={() => select(r.id)}>
                <span className="rv-row-top"><b>{r.title}</b><span className={"rv-status " + st.cls}>{st.label}</span></span>
                <span className="rv-row-sub">
                  <span>{r.isRequester ? "You" : nameOf(r.requester)}</span><span>·</span><span>v{r.version}</span><span>·</span><span>{r.itemCount} item{r.itemCount === 1 ? "" : "s"}</span>
                  {r.dueDate && <><span>·</span><span className={isLate(r) ? "late" : ""}>due {fmtDate(r.dueDate)}</span></>}
                </span>
                <span className="rv-row-bar"><i className="ok" style={{ width: `${(r.counts.approved / Math.max(1, r.counts.total)) * 100}%` }} /><i className="chg" style={{ width: `${(r.counts.changes / Math.max(1, r.counts.total)) * 100}%` }} /><em>{r.counts.approved}/{r.counts.total}</em></span>
                {r.myDecision === "PENDING" && live(r) && <span className="rv-you">Waiting for you</span>}
              </button>
            );
          })}
        </div>
      </aside>
      <main className="rv-main">
        {openId
          ? <><button className="rv-back" onClick={() => select(null)}>← All reviews</button><ReviewDetail key={openId} id={openId} me={me} notify={notify} onChanged={load} /></>
          : <div className="rv-detail rv-empty"><EmptyState icon={<Eye size={28} />} title="Pick a review" text="Open one from the list to see links, files, who has approved, and the conversation." /></div>}
      </main>
      {showNew && <NewReviewWindow me={me} notify={notify} onClose={() => setShowNew(false)} onCreated={(r) => { setShowNew(false); setTab("mine"); load(); select(r.id); }} />}
    </div>
  );
}
