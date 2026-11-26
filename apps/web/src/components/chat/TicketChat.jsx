import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Send, ArrowLeft, Plus, X, Pin, PinOff, Pencil, Trash2, MoreHorizontal, Ban, Reply, Info, ExternalLink, UserPlus,
  CheckCircle2, RotateCcw, ListPlus, Search, SmilePlus, Copy, ArrowDown, PanelRight, Activity, FileText, Download, Users, ChevronUp,
} from "lucide-react";
import Avatar from "../ui/Avatar";
import { api } from "../../api";
import * as realtime from "../../lib/realtime";
import { tickStatus, EDIT_WINDOW_MS, nameOf } from "../../lib/chatTicks";
import { buildTimeline, firstUnreadId, previewOf } from "../../lib/chatTimeline";
import { describeEvent, actorLabel } from "../../lib/ticketHistory";
import { ACCEPT, uploadFile, uploadErrorText, fetchBlob, openFile, saveFile, fmtSize } from "../../lib/files";
import { fmtTime, fmtDateTime, fmtDate } from "../../lib/dates";
import { Ticks, Body } from "./ChatBits";
import TeamMultiSelect from "../ui/TeamMultiSelect";
import "../../styles/ticket-chat.css";
import { TicketStatusBadge, PriorityBadge } from "../ui/StatusBadge";

const EMOJIS = ["👍", "✅", "👀", "❤️", "🎉", "🙏", "😂", "❓"]; // keep in sync with REACTION_EMOJIS in the API
const QUICK = EMOJIS.slice(0, 3);
const TYPING_MS = 3500;
const PAGE = 50;
const draftKey = (id) => `tdl_chat_draft:${id}`;
const readDraft = (id) => { try { return localStorage.getItem(draftKey(id)) || ""; } catch { return ""; } };
const writeDraft = (id, v) => { try { v ? localStorage.setItem(draftKey(id), v) : localStorage.removeItem(draftKey(id)); } catch { /* ignore */ } };
const isImage = (mime = "") => mime.startsWith("image/");

/** Image thumbnail loaded through the authenticated API (files are never public). */
function ChatImage({ file }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let off = false, made = "";
    fetchBlob(file.id).then((b) => { if (!off) { made = URL.createObjectURL(b); setUrl(made); } }).catch(() => {});
    return () => { off = true; if (made) URL.revokeObjectURL(made); };
  }, [file.id]);
  return (
    <button type="button" className="tc-img" onClick={() => openFile(file).catch(() => {})} aria-label={`Open ${file.originalName}`} title={file.originalName}>
      {url ? <img src={url} alt={file.originalName} /> : <span className="tc-img-ph">Loading…</span>}
    </button>
  );
}

function FileChip({ file }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const get = async (open) => { setBusy(true); setErr(""); try { await (open ? openFile(file) : saveFile(file)); } catch { setErr("Could not open"); } setBusy(false); };
  const canOpen = file.mimeType === "application/pdf";
  return (
    <span className="tc-file">
      <FileText size={18} />
      <span><b title={file.originalName}>{file.originalName}</b><small>{fmtSize(file.size)}{err ? ` · ${err}` : ""}</small></span>
      {canOpen && <button type="button" className="icon-btn" onClick={() => get(true)} disabled={busy} aria-label={`View ${file.originalName}`} title="View"><ExternalLink size={14} /></button>}
      <button type="button" className="icon-btn" onClick={() => get(false)} disabled={busy} aria-label={`Download ${file.originalName}`} title="Download"><Download size={14} /></button>
    </span>
  );
}

export default function TicketChat({ room, me, users = [], notify, onBackToList, onRoomChanged }) {
  const meId = me.user.id;
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [members, setMembers] = useState([]);
  const [pins, setPins] = useState([]);
  const [files, setFiles] = useState([]);
  const [receipts, setReceipts] = useState({});
  const [ticket, setTicket] = useState(null);
  const [events, setEvents] = useState([]);
  const [showActivity, setShowActivity] = useState(() => { try { return localStorage.getItem("tdl_chat_activity") !== "0"; } catch { return true; } });
  const [typing, setTyping] = useState(null); // { name, until }
  const [online, setOnline] = useState(realtime.getOnline());
  const [live, setLive] = useState(realtime.isOpen());
  const [draft, setDraft] = useState(() => readDraft(room.id));
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [atts, setAtts] = useState([]); // [{ key, name, size, status: "up"|"ok"|"err", file? }]
  const [dragging, setDragging] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [reactFor, setReactFor] = useState(null);
  const [sel, setSel] = useState(null); // tapped row on touch screens
  const [pop, setPop] = useState({}); // fixed position of the open menu (so the message list never clips it)
  const [panel, setPanel] = useState(() => window.innerWidth >= 1180 ? "details" : null); // details | pins | files | people | null
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [infoFor, setInfoFor] = useState(null);
  const [info, setInfo] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [inviteUsers, setInviteUsers] = useState([]);
  const [inviteTeams, setInviteTeams] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [newBelow, setNewBelow] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const unreadAtOpen = useRef(room.unread || 0);
  const [unreadId, setUnreadId] = useState(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const mentionMap = useRef({});
  const pending = useRef(new Map());
  const lastTyped = useRef(0);
  const stick = useRef(true); // keep the view pinned to the newest message
  const prepend = useRef(null); // scroll anchor while older messages are inserted above

  const markRead = useCallback(() => { if (!realtime.send({ type: "chat.read", roomId: room.id })) api.post(`/chat/rooms/${room.id}/read`).then(() => realtime.emit("chat.unread.refresh")).catch(() => {}); }, [room.id]);
  const merge = useCallback((incoming) => setMessages((cur) => { const seen = new Set(cur.map((m) => m.id)); const add = incoming.filter((m) => !seen.has(m.id)); return add.length ? [...cur, ...add] : cur; }), []);
  const loadExtras = useCallback(() => {
    api.get(`/chat/rooms/${room.id}/members`).then((r) => setMembers(r.data)).catch(() => {});
    api.get(`/chat/rooms/${room.id}/pins`).then((r) => setPins(r.data)).catch(() => {});
    api.get(`/chat/rooms/${room.id}/files`).then((r) => setFiles(r.data)).catch(() => {});
    api.get(`/chat/rooms/${room.id}/receipts`).then((r) => setReceipts(Object.fromEntries(r.data.map((x) => [x.userId, x])))).catch(() => {});
  }, [room.id]);
  const loadTicket = useCallback(() => {
    if (!room.ticketId) return;
    api.get("/tickets", { params: { id: room.ticketId } }).then((r) => setTicket(r.data?.[0] || null)).catch(() => {});
    api.get(`/tickets/${room.ticketId}/history`).then((r) => setEvents(Array.isArray(r.data) ? r.data : r.data?.events || [])).catch(() => {});
  }, [room.ticketId]);
  const loadMessages = useCallback(() => api.get(`/chat/rooms/${room.id}/messages`).then((r) => { setMessages(r.data); setHasEarlier(r.data.length >= PAGE); setLoaded(true); markRead(); }).catch(() => setLoaded(true)), [room.id, markRead]);

  useEffect(() => { loadMessages(); loadExtras(); loadTicket(); }, [loadMessages, loadExtras, loadTicket]);
  useEffect(() => { if (loaded && unreadAtOpen.current) { setUnreadId(firstUnreadId(messages, meId, unreadAtOpen.current)); unreadAtOpen.current = 0; } }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { writeDraft(room.id, draft); }, [room.id, draft]);

  const loadEarlier = useCallback(async () => {
    if (!messages.length) return 0;
    const el = logRef.current;
    prepend.current = el ? { h: el.scrollHeight, t: el.scrollTop } : null;
    const { data } = await api.get(`/chat/rooms/${room.id}/messages`, { params: { before: messages[0].createdAt } });
    setMessages((cur) => { const seen = new Set(cur.map((m) => m.id)); return [...data.filter((m) => !seen.has(m.id)), ...cur]; });
    setHasEarlier(data.length >= PAGE);
    return data.length;
  }, [messages, room.id]);

  // live events
  useEffect(() => {
    const offs = [
      realtime.on("chat.message", ({ message }) => {
        if (message.roomId !== room.id) return;
        merge([message]);
        if (message.authorId !== meId) { if (!document.hidden) markRead(); setTyping(null); }
        if (message.attachments?.length) api.get(`/chat/rooms/${room.id}/files`).then((r) => setFiles(r.data)).catch(() => {});
        const el = logRef.current;
        const near = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 140 : true;
        if (message.authorId === meId || near) stick.current = true; else setNewBelow((n) => n + 1);
      }),
      realtime.on("chat.typing", ({ roomId, userId, name }) => {
        if (roomId !== room.id || userId === meId) return;
        setTyping({ name, until: Date.now() + TYPING_MS });
        setTimeout(() => setTyping((t) => (t && t.until <= Date.now() ? null : t)), TYPING_MS + 100);
      }),
      realtime.on("chat.message.updated", ({ message }) => {
        if (message.roomId !== room.id) return;
        setMessages((cur) => cur.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
        setPins((cur) => { const rest = cur.filter((p) => p.id !== message.id); return message.pinnedAt && !message.deletedAt ? [{ ...message }, ...rest].sort((a, b) => new Date(b.pinnedAt) - new Date(a.pinnedAt)) : rest; });
        api.get(`/chat/rooms/${room.id}/files`).then((r) => setFiles(r.data)).catch(() => {});
      }),
      realtime.on("chat.receipt", ({ roomId, userId, kind, at }) => {
        if (roomId !== room.id || userId === meId) return;
        setReceipts((cur) => ({ ...cur, [userId]: { ...cur[userId], userId, [kind === "read" ? "readAt" : "deliveredAt"]: at } }));
      }),
      realtime.on("chat.room.updated", ({ roomId }) => { if (roomId === room.id) { loadExtras(); loadTicket(); onRoomChanged?.(); } }),
      realtime.on("chat.error", ({ tempId, error }) => { notify(error || "Message not sent", "error"); const b = pending.current.get(tempId); if (b) { pending.current.delete(tempId); setDraft((d) => d || b); } }),
      realtime.on("chat.ack", ({ tempId }) => pending.current.delete(tempId)),
      realtime.on("presence", (set) => setOnline(new Set(set))),
      realtime.on("open", () => { setLive(true); loadMessages(); loadExtras(); loadTicket(); }),
      realtime.on("close", () => setLive(false)),
    ];
    return () => offs.forEach((off) => off());
  }, [room.id, meId, merge, markRead, loadMessages, loadExtras, loadTicket, notify, onRoomChanged]);
  useEffect(() => { const v = () => !document.hidden && markRead(); document.addEventListener("visibilitychange", v); return () => document.removeEventListener("visibilitychange", v); }, [markRead]);

  // scrolling: stay at the bottom for new messages, keep position when older ones load, land on the unread line first
  const rows = useMemo(() => buildTimeline({ messages, events, showEvents: showActivity, hasEarlier, unreadId }), [messages, events, showActivity, hasEarlier, unreadId]);
  const firstScroll = useRef(true);
  useLayoutEffect(() => {
    const el = logRef.current; if (!el) return;
    if (prepend.current) { el.scrollTop = el.scrollHeight - prepend.current.h + prepend.current.t; prepend.current = null; return; }
    if (firstScroll.current && loaded) {
      firstScroll.current = false;
      const u = el.querySelector(".tc-unread");
      if (u) el.scrollTop = Math.max(0, u.offsetTop - 80); else el.scrollTop = el.scrollHeight;
      return;
    }
    if (stick.current) { el.scrollTop = el.scrollHeight; stick.current = false; setNewBelow(0); }
  }, [rows.length, loaded]);
  const onScroll = () => { setMenuFor(null); setReactFor(null); const el = logRef.current; const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140; setAtBottom(near); if (near) setNewBelow(0); };
  const toBottom = () => { const el = logRef.current; el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); setNewBelow(0); };

  const jumpTo = useCallback(async (id) => {
    for (let i = 0; i < 6 && !document.getElementById(`tcm-${id}`); i += 1) { if (!hasEarlier) break; await loadEarlier().catch(() => {}); await new Promise((r) => setTimeout(r, 60)); }
    const el = document.getElementById(`tcm-${id}`);
    if (!el) { notify("That message is too far back. Scroll up to load older messages.", "error"); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
  }, [hasEarlier, loadEarlier, notify]);

  // composer
  const addFiles = useCallback((list) => {
    for (const f of Array.from(list || [])) {
      if (atts.length >= 6) { notify("You can attach up to 6 files per message.", "error"); break; }
      const key = crypto.randomUUID();
      setAtts((cur) => [...cur, { key, name: f.name, size: f.size, status: "up", mime: f.type, preview: isImage(f.type) ? URL.createObjectURL(f) : "" }]);
      uploadFile(f, { chatRoomId: room.id })
        .then((r) => setAtts((cur) => cur.map((a) => (a.key === key ? { ...a, id: r.id, status: "ok" } : a))))
        .catch((e) => { notify(uploadErrorText(e, f), "error"); setAtts((cur) => cur.filter((a) => a.key !== key)); });
    }
  }, [atts.length, room.id, notify]);
  useEffect(() => () => atts.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const onPaste = (e) => { const fs = Array.from(e.clipboardData?.files || []); if (fs.length) { e.preventDefault(); addFiles(fs); } };
  const growInput = () => { const el = inputRef.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 170)}px`; } };
  useEffect(growInput, [draft]);

  const mentionIdsFor = (body) => [...new Set(Object.entries(mentionMap.current).filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id))];
  const submit = async (e) => {
    e?.preventDefault();
    const body = draft.trim();
    if (editing) {
      if (!body) return;
      try { const { data } = await api.patch(`/chat/messages/${editing.id}`, { body }); setMessages((cur) => cur.map((m) => (m.id === data.id ? { ...m, ...data } : m))); setEditing(null); setDraft(""); }
      catch (err) { notify(err.response?.data?.error || "Could not edit message", "error"); }
      return;
    }
    if (atts.some((a) => a.status === "up")) { notify("Wait for the upload to finish.", "error"); return; }
    const attachmentIds = atts.filter((a) => a.status === "ok").map((a) => a.id);
    if (!body && !attachmentIds.length) return;
    const mentionIds = mentionIdsFor(body);
    const replyToId = replyTo?.id;
    setDraft(""); setReplyTo(null); setAtts([]); mentionMap.current = {}; stick.current = true;
    const tempId = crypto.randomUUID();
    pending.current.set(tempId, body);
    if (!attachmentIds.length && realtime.send({ type: "chat.send", roomId: room.id, body, mentionIds, replyToId, tempId })) return; // the echo arrives as "chat.message"
    try { const { data } = await api.post(`/chat/rooms/${room.id}/messages`, { body, mentionIds, replyToId, attachmentIds }); merge([data]); pending.current.delete(tempId); }
    catch (err) { notify(err.response?.data?.error || "Message not sent", "error"); setDraft((d) => d || body); }
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); return; }
    if (e.key === "Escape") { if (editing) { setEditing(null); setDraft(""); } else if (replyTo) setReplyTo(null); return; }
    if (e.key === "ArrowUp" && !draft && !editing) { // edit my last message (inside the 15-minute window)
      const last = [...messages].reverse().find((m) => m.authorId === meId && !m.deletedAt);
      if (last && Date.now() - new Date(last.createdAt).getTime() <= EDIT_WINDOW_MS) { e.preventDefault(); startEdit(last); }
    }
  };
  const onType = (e) => { setDraft(e.target.value); if (Date.now() - lastTyped.current > 2500) { lastTyped.current = Date.now(); realtime.send({ type: "chat.typing", roomId: room.id }); } };

  // message actions
  const startEdit = (m) => { setMenuFor(null); setReplyTo(null); setEditing(m); setDraft(m.body); setTimeout(() => inputRef.current?.focus(), 0); };
  const startReply = (m) => { setMenuFor(null); setEditing(null); setReplyTo(m); setTimeout(() => inputRef.current?.focus(), 0); };
  const togglePin = (m) => { setMenuFor(null); api[m.pinnedAt ? "delete" : "put"](`/chat/messages/${m.id}/pin`).catch((err) => notify(err.response?.data?.error || "Could not update pin", "error")); };
  const remove = (m) => { setMenuFor(null); if (window.confirm("Delete this message for everyone?")) api.delete(`/chat/messages/${m.id}`).catch((err) => notify(err.response?.data?.error || "Could not delete", "error")); };
  const makeTask = async (m) => { setMenuFor(null); try { const { data } = await api.post(`/chat/messages/${m.id}/task`); notify(`Task created: ${data.title}`, "success"); } catch (e) { notify(e.response?.data?.error || "Could not create the task", "error"); } };
  const openPop = (e, id, kind) => {
    const r = e.currentTarget.getBoundingClientRect();
    const down = window.innerHeight - r.bottom > (kind === "menu" ? 330 : 90);
    setPop({ right: Math.max(8, window.innerWidth - r.right), ...(down ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) });
    if (kind === "menu") { setMenuFor(menuFor === id ? null : id); setReactFor(null); } else { setReactFor(reactFor === id ? null : id); setMenuFor(null); }
  };
  const copyText = async (m) => { setMenuFor(null); try { await navigator.clipboard.writeText(m.body); notify("Copied", "success"); } catch { notify("Could not copy", "error"); } };
  const react = async (m, emoji) => { setMenuFor(null); setReactFor(null); try { const { data } = await api.put(`/chat/messages/${m.id}/reaction`, { emoji }); setMessages((cur) => cur.map((x) => (x.id === data.id ? { ...x, ...data } : x))); } catch (e) { notify(e.response?.data?.error || "Could not react", "error"); } };
  const openInfo = (m) => { setMenuFor(null); setInfoFor(m); setInfo(null); api.get(`/chat/messages/${m.id}/info`).then((r) => setInfo(r.data)).catch((e) => { notify(e.response?.data?.error || "Could not load info", "error"); setInfoFor(null); }); };
  const deleteFile = async (f) => { if (!window.confirm(`Delete "${f.originalName}" permanently?\n\nIt is removed from the chat and from the server and cannot be recovered.`)) return; try { await api.delete(`/files/${f.id}`); setFiles((cur) => cur.filter((x) => x.id !== f.id)); } catch (e) { notify(e.response?.data?.error || "Could not delete this file", "error"); } };
  const isAdmin = (me.roles || []).includes("PLATFORM_ADMIN");
  const mayDeleteFile = (f) => f.uploadedById === meId || isAdmin || ticket?.requesterId === meId;
  const toggleResolved = async () => { try { await api.put(`/chat/rooms/${room.id}/resolved`, { resolved: !room.resolvedAt }); onRoomChanged?.(); } catch (e) { notify(e.response?.data?.error || "Could not update the discussion", "error"); } };
  const openInvite = () => { setInviteUsers([]); setInviteTeams([]); setInviting(true); api.get("/teams").then((r) => setAllTeams(Array.isArray(r.data) ? r.data : r.data?.teams || [])).catch(() => setAllTeams([])); };
  const sendInvite = async () => {
    try { const { data } = await api.post(`/chat/rooms/${room.id}/invite`, { userIds: inviteUsers, teamIds: inviteTeams }); notify(data.added?.length ? `Added ${data.added.map((u) => u.name).join(", ")}` : "Everyone selected is already here", "success"); setInviting(false); loadExtras(); onRoomChanged?.(); }
    catch (e) { notify(e.response?.data?.error || "Could not invite", "error"); }
  };

  // search
  useEffect(() => {
    if (!searchOpen || q.trim().length < 2) { setResults(null); return undefined; }
    const t = setTimeout(() => api.get(`/chat/rooms/${room.id}/search`, { params: { q: q.trim() } }).then((r) => setResults(r.data)).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q, searchOpen, room.id]);
  const toggleActivity = () => setShowActivity((v) => { try { localStorage.setItem("tdl_chat_activity", v ? "0" : "1"); } catch { /* ignore */ } return !v; });

  // @mentions
  const mq = /(?:^|\s)@([\w.-]*)$/.exec(draft);
  const mentionQuery = !editing && mq ? mq[1].toLowerCase() : null;
  const allOption = { id: "*", name: "all", email: "Notify everyone in this discussion" };
  const suggestions = mentionQuery === null ? [] : [...("all".startsWith(mentionQuery) || "everyone".startsWith(mentionQuery) ? [allOption] : []), ...members.filter((u) => u.id !== meId && (nameOf(u).toLowerCase().includes(mentionQuery) || (u.email || "").toLowerCase().includes(mentionQuery)))].slice(0, 6);
  const pickMention = (u) => { const n = nameOf(u); if (u.id !== "*") mentionMap.current[n] = u.id; setDraft((d) => d.replace(/@([\w.-]*)$/, `@${n} `)); inputRef.current?.focus(); };

  const receiptList = Object.values(receipts);
  const typingNow = typing && typing.until > Date.now() ? typing.name : null;
  const others = users.filter((u) => u.id !== meId);
  const person = (id) => members.find((u) => u.id === id) || users.find((u) => u.id === id);
  const t = ticket;
  const assignee = t?.assignee?.name || t?.assignee?.email;

  const renderMessage = ({ m, grouped }) => {
    const own = m.authorId === meId;
    const deleted = !!m.deletedAt;
    const canEdit = own && !deleted && Date.now() - new Date(m.createdAt).getTime() <= EDIT_WINDOW_MS;
    const canDelete = !deleted && (own || me.isManager);
    const pinged = (m.mentionIds || []).includes(meId);
    const imgs = (m.attachments || []).filter((a) => isImage(a.mimeType));
    const docs = (m.attachments || []).filter((a) => !isImage(a.mimeType));
    const author = m.author?.name || m.author?.email;
    return (
      <div key={m.id} id={`tcm-${m.id}`} className={"tc-msg" + (own ? " own" : "") + (grouped ? " grouped" : "") + (pinged ? " pinged" : "") + (menuFor === m.id || reactFor === m.id ? " menu-open" : "") + (sel === m.id ? " sel" : "")}
        onClick={(e) => { if (e.target.closest(".tc-actions, a, button")) return; e.stopPropagation(); setMenuFor(null); setReactFor(null); setSel(sel === m.id ? null : m.id); }}>
        {grouped ? <span className="tc-av-gap"><span className="tc-gtime">{fmtTime(m.createdAt)}</span></span> : <Avatar name={author} />}
        <div className="tc-col">
          {!grouped && <small className="tc-meta"><b>{own ? `${author || "You"} (you)` : author}</b><time>{fmtDate(m.createdAt)}, {fmtTime(m.createdAt)}</time>{m.editedAt && !deleted ? <em className="tc-edited">(edited)</em> : ""}{m.pinnedAt && !deleted ? <span className="tc-decision"><Pin size={11} /> Decision</span> : null}</small>}
          <div className="tc-bubble">
            {!deleted && m.replyTo && (
              <button type="button" className="tc-quote" onClick={() => jumpTo(m.replyTo.id)} aria-label="Go to the original message">
                <b>{m.replyTo.authorId === meId ? "You" : nameOf(m.replyTo.author)}</b><span>{m.replyTo.deletedAt ? "This message was deleted" : m.replyTo.body}</span>
              </button>
            )}
            {deleted ? <p className="gone"><Ban size={13} /> This message was deleted</p> : (
              <>
                {m.body && <p><Body text={m.body} members={members} meId={meId} /></p>}
                {imgs.length > 0 && <div className={"tc-imgs n" + Math.min(imgs.length, 3)}>{imgs.map((a) => <ChatImage key={a.id} file={a} />)}</div>}
                {docs.map((a) => <FileChip key={a.id} file={a} />)}
              </>
            )}
            {!deleted && own && <span className="tc-time"><Ticks status={tickStatus(m, receiptList)} /></span>}
          </div>
          {!deleted && (m.reactions || []).length > 0 && (
            <div className="tc-reacts">
              {m.reactions.map((r) => {
                const mine = r.userIds.includes(meId);
                const names = r.userIds.map((id) => (id === meId ? "You" : nameOf(person(id)))).join(", ");
                return <button type="button" key={r.emoji} className={"tc-react" + (mine ? " mine" : "")} onClick={() => react(m, r.emoji)} title={names} aria-label={`${r.emoji} ${r.userIds.length}: ${names}`}>{r.emoji}<i>{r.userIds.length}</i></button>;
              })}
            </div>
          )}
          {!deleted && (
            <div className="tc-actions" role="toolbar" aria-label="Message actions">
              {QUICK.map((e) => <button type="button" key={e} className="icon-btn" onClick={() => react(m, e)} aria-label={`React ${e}`}>{e}</button>)}
              <button type="button" className="icon-btn" onClick={(e) => openPop(e, m.id, "palette")} aria-label="More reactions"><SmilePlus size={15} /></button>
              <button type="button" className="icon-btn" onClick={() => startReply(m)} aria-label="Reply"><Reply size={15} /></button>
              <button type="button" className="icon-btn" onClick={(e) => openPop(e, m.id, "menu")} aria-label="More actions"><MoreHorizontal size={15} /></button>
              {reactFor === m.id && <div className="menu tc-palette" role="menu" style={{ position: "fixed", left: "auto", ...pop }}>{EMOJIS.map((e) => <button type="button" key={e} onClick={() => react(m, e)} aria-label={`React ${e}`}>{e}</button>)}</div>}
              {menuFor === m.id && (
                <div className="menu" role="menu" style={{ position: "fixed", left: "auto", ...pop }}>
                  <button type="button" onClick={() => startReply(m)}><Reply size={14} /> Reply</button>
                  {m.body && <button type="button" onClick={() => copyText(m)}><Copy size={14} /> Copy text</button>}
                  <button type="button" onClick={() => togglePin(m)}>{m.pinnedAt ? <><PinOff size={14} /> Remove decision pin</> : <><Pin size={14} /> Pin as decision</>}</button>
                  {m.body && <button type="button" onClick={() => makeTask(m)}><ListPlus size={14} /> Create task</button>}
                  {own && <button type="button" onClick={() => openInfo(m)}><Info size={14} /> Message info</button>}
                  {canEdit && <button type="button" onClick={() => startEdit(m)}><Pencil size={14} /> Edit</button>}
                  {canDelete && <button type="button" className="danger" onClick={() => remove(m)}><Trash2 size={14} /> Delete for everyone</button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const panelTabs = [["details", "Details"], ["pins", `Decisions${pins.length ? ` (${pins.length})` : ""}`], ["files", `Files${files.length ? ` (${files.length})` : ""}`], ["people", `People (${members.length})`]];

  return (
    <section className={"chat-main tchat" + (dragging ? " dragging" : "")}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); } }}>
      <div className="tchat-body">
        <div className="tchat-center">
          <div className="tc-head">
            <button type="button" className="back icon-btn" onClick={onBackToList} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
            <div className="tc-title">
              <span className="tc-key">{t?.key || room.name.split(" · ")[0]}</span>
              <b title={t?.title || room.name}>{t?.title || room.name.split(" · ").slice(1).join(" · ")}</b>
              <small>
                {t && <><TicketStatusBadge ticket={t} /> <PriorityBadge value={t.priority} /> · </>}
                {members.length} {members.length === 1 ? "person" : "people"}{room.resolvedAt ? " · Resolved" : ""} · <span className={live ? "live" : "offline"}>{live ? "Live" : "Reconnecting…"}</span>
              </small>
            </div>
            <div className="tc-tools">
              <button type="button" className={"icon-btn" + (searchOpen ? " on" : "")} onClick={() => { setSearchOpen((v) => !v); setQ(""); }} aria-label="Search this discussion" title="Search"><Search size={17} /></button>
              <button type="button" className={"icon-btn" + (showActivity ? " on" : "")} onClick={toggleActivity} aria-label="Show ticket activity in the chat" title={showActivity ? "Hide ticket activity" : "Show ticket activity"}><Activity size={17} /></button>
              <button type="button" className={"icon-btn" + (panel ? " on" : "")} onClick={() => setPanel((p) => (p ? null : "details"))} aria-label="Toggle details panel" title="Details"><PanelRight size={17} /></button>
              <button type="button" className="secondary tc-open" onClick={() => navigate(`/tickets?ticket=${room.ticketId}`)}><ExternalLink size={14} /><span>Ticket</span></button>
            </div>
          </div>

          {room.resolvedAt && <div className="tc-banner"><CheckCircle2 size={15} /> This discussion is resolved. A new message reopens it. <button type="button" className="tw-link" onClick={toggleResolved}>Reopen now</button></div>}
          {searchOpen && (
            <div className="tc-search">
              <Search size={15} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages in this discussion" aria-label="Search messages" />
              <button type="button" className="icon-btn" onClick={() => { setSearchOpen(false); setQ(""); }} aria-label="Close search"><X size={15} /></button>
              {results && (
                <div className="tc-results">
                  {!results.length && <small className="muted">No messages found.</small>}
                  {results.map((m) => <button type="button" key={m.id} onClick={() => { setSearchOpen(false); setQ(""); jumpTo(m.id); }}><b>{nameOf(m.author)}</b><span>{previewOf(m)}</span><small>{fmtDateTime(m.createdAt)}</small></button>)}
                </div>
              )}
            </div>
          )}
          {pins[0] && !panel && <button type="button" className="tc-pinbar" onClick={() => jumpTo(pins[0].id)}><Pin size={13} /><span><b>Decision{pins.length > 1 ? `s (${pins.length})` : ""}</b> {pins[0].body}</span></button>}

          <div className="tc-log" ref={logRef} onScroll={onScroll} onClick={(e) => { if (e.target.closest(".tc-actions")) return; setMenuFor(null); setReactFor(null); setSel(null); }}>
            {hasEarlier && <button type="button" className="tc-earlier" onClick={() => loadEarlier().catch(() => notify("Could not load older messages", "error"))}><ChevronUp size={14} /> Load earlier messages</button>}
            {!loaded && <small className="muted tc-empty">Loading the discussion…</small>}
            {loaded && !messages.length && (
              <div className="tc-empty"><b>Start the discussion</b><small>Ask a question, share a screenshot or PDF, @mention a teammate. Pin the final answer as a decision so it shows on the ticket.</small></div>
            )}
            {rows.map((r) => {
              if (r.kind === "day") return <div key={r.key} className="tc-day"><span>{r.label}</span></div>;
              if (r.kind === "unread") return <div key={r.key} className="tc-unread"><span>New messages</span></div>;
              if (r.kind === "event") return <div key={r.key} className="tc-event"><Activity size={12} /><span><b>{actorLabel(r.e, false)}</b> {describeEvent(r.e)} · {fmtDate(r.e.createdAt)}, {fmtTime(r.e.createdAt)}</span></div>;
              return renderMessage(r);
            })}
          </div>
          {newBelow > 0 && !atBottom && <button type="button" className="tc-jump new" onClick={toBottom}><ArrowDown size={14} /> {newBelow} new message{newBelow === 1 ? "" : "s"}</button>}
          {newBelow === 0 && !atBottom && <button type="button" className="tc-jump" onClick={toBottom} aria-label="Jump to the latest message"><ArrowDown size={16} /></button>}

          <div className="tc-typing" aria-live="polite">{typingNow ? `${typingNow} is typing…` : ""}</div>
          {replyTo && <div className="tc-bar reply"><Reply size={14} /><span>Replying to <b>{replyTo.authorId === meId ? "yourself" : nameOf(replyTo.author)}</b>: {previewOf(replyTo).slice(0, 90)}</span><button type="button" className="icon-btn" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
          {editing && <div className="tc-bar"><Pencil size={14} /><span>Editing message · Esc to cancel</span><button type="button" className="icon-btn" onClick={() => { setEditing(null); setDraft(""); }} aria-label="Cancel edit"><X size={14} /></button></div>}
          {atts.length > 0 && (
            <div className="tc-atts">
              {atts.map((a) => (
                <span key={a.key} className={"tc-att " + a.status}>
                  {a.preview ? <img src={a.preview} alt="" /> : <FileText size={16} />}
                  <span><b>{a.name}</b><small>{a.status === "up" ? "Uploading…" : fmtSize(a.size)}</small></span>
                  <button type="button" className="icon-btn" onClick={() => { if (a.id) api.delete(`/files/${a.id}`).catch(() => {}); setAtts((cur) => cur.filter((x) => x.key !== a.key)); }} aria-label={`Remove ${a.name}`}><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
          {mentionQuery !== null && suggestions.length > 0 && (
            <div className="mention-list tc-mentions" role="listbox" aria-label="Mention someone">
              {suggestions.map((u) => <button type="button" key={u.id} role="option" onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}><Avatar name={u.name || u.email} /><span><b>{nameOf(u)}</b><small>{u.email}</small></span></button>)}
            </div>
          )}
          <form className="tc-composer" onSubmit={submit}>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <div className="tc-box">
              <button type="button" className="tc-attach" onClick={() => fileRef.current?.click()} aria-label="Attach a file" title="Attach a file or screenshot"><Plus size={20} /></button>
              <textarea ref={inputRef} rows={1} value={draft} onChange={onType} onKeyDown={onKeyDown} onPaste={onPaste} maxLength={4000} aria-label="Message"
                placeholder={editing ? "Edit your message" : replyTo ? "Write a reply…" : `Message ${t?.key || "the discussion"}`} />
              <button type="submit" className="tc-send" disabled={editing ? !draft.trim() : !draft.trim() && !atts.some((a) => a.status === "ok")} aria-label={editing ? "Save" : "Send"} title={editing ? "Save" : "Send"}><Send size={18} /></button>
            </div>
          </form>
          <small className="tc-hint">Enter to send · Shift+Enter for new line · ↑ edit last message · paste or drop files</small>
        </div>

        {panel && (
          <aside className="tchat-panel" aria-label="Discussion details">
            <div className="tp-tabs" role="tablist">
              {panelTabs.map(([id, label]) => <button type="button" role="tab" aria-selected={panel === id} key={id} className={panel === id ? "on" : ""} onClick={() => setPanel(id)}>{label}</button>)}
              <button type="button" className="icon-btn tp-close" onClick={() => setPanel(null)} aria-label="Close panel"><X size={15} /></button>
            </div>
            <div className="tp-body">
              {panel === "details" && (
                <>
                  {t ? (
                    <dl className="tp-facts">
                      <div><dt>Status</dt><dd><TicketStatusBadge ticket={t} /></dd></div>
                      <div><dt>Priority</dt><dd><PriorityBadge value={t.priority} /></dd></div>
                      <div><dt>Assignee</dt><dd>{assignee || "Unassigned"}</dd></div>
                      <div><dt>Raised by</dt><dd>{t.requester?.name || t.requester?.email || "—"}</dd></div>
                      <div><dt>Due</dt><dd>{fmtDate(t.dueDate, "No due date")}</dd></div>
                      <div><dt>Raised</dt><dd>{fmtDate(t.createdAt)}</dd></div>
                    </dl>
                  ) : <small className="muted">Loading ticket…</small>}
                  <div className="tp-actions">
                    <button type="button" className="secondary" onClick={() => navigate(`/tickets?ticket=${room.ticketId}`)}><ExternalLink size={14} /> Open the ticket</button>
                    <button type="button" className="secondary" onClick={openInvite}><UserPlus size={14} /> Invite people</button>
                    <button type="button" className="secondary" onClick={toggleResolved}>{room.resolvedAt ? <><RotateCcw size={14} /> Reopen discussion</> : <><CheckCircle2 size={14} /> Mark resolved</>}</button>
                  </div>
                  {pins[0] && <div className="tp-decision"><small>LATEST DECISION</small><button type="button" onClick={() => jumpTo(pins[0].id)}>{pins[0].body}</button></div>}
                </>
              )}
              {panel === "pins" && (
                <>
                  {!pins.length && <small className="muted">No decisions pinned yet. Use ⋯ then “Pin as decision” on the message that settles a question (up to 3).</small>}
                  {pins.map((p) => <div className="tp-item" key={p.id}><button type="button" onClick={() => jumpTo(p.id)}><b>{nameOf(p.author)}</b><span>{p.body}</span><small>{fmtDateTime(p.createdAt)}</small></button><button type="button" className="icon-btn" onClick={() => togglePin(p)} aria-label="Unpin"><PinOff size={14} /></button></div>)}
                </>
              )}
              {panel === "files" && (
                <>
                  {!files.length && <small className="muted">Files and screenshots shared in this discussion appear here.</small>}
                  {files.map((f) => (
                    <div className="tp-item" key={f.id}>
                      <button type="button" onClick={() => jumpTo(f.chatMessageId)}><b title={f.originalName}>{f.originalName}</b><small>{fmtSize(f.size)} · {nameOf(person(f.uploadedById))} · {fmtDate(f.createdAt)}</small></button>
                      <button type="button" className="icon-btn" onClick={() => (/^(image\/|application\/pdf)/.test(f.mimeType) ? openFile(f) : saveFile(f)).catch(() => notify("Could not open the file", "error"))} aria-label={`Open ${f.originalName}`}><Download size={14} /></button>
                      {mayDeleteFile(f) && <button type="button" className="icon-btn danger" onClick={() => deleteFile(f)} aria-label={`Delete ${f.originalName}`}><Trash2 size={14} /></button>}
                    </div>
                  ))}
                </>
              )}
              {panel === "people" && (
                <>
                  {members.map((u) => <div className="tp-person" key={u.id}><span className="dm-dot-wrap"><Avatar name={u.name || u.email} /><i className={"dot" + (online.has(u.id) ? " on" : "")} /></span><span><b>{nameOf(u)}{u.id === meId ? " (you)" : ""}</b><small>{online.has(u.id) ? "Online" : "Offline"}{t?.assigneeId === u.id ? " · Assignee" : ""}{t?.requesterId === u.id ? " · Raised the ticket" : ""}</small></span></div>)}
                  <button type="button" className="secondary" onClick={openInvite}><Users size={14} /> Invite people</button>
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      {infoFor && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setInfoFor(null)}>
          <div className="modal">
            <div className="modal-head"><span><small>MESSAGE INFO</small><h2>{previewOf(infoFor).slice(0, 60)}</h2></span><button type="button" onClick={() => setInfoFor(null)}><X /></button></div>
            <div className="modal-body">
              {!info && <small className="muted">Loading…</small>}
              {info && [["Read by", info.readBy, "read"], ["Delivered to", info.deliveredTo, "delivered"]].map(([label, list, kind]) => (
                <div key={label} className="info-group"><small>{label} ({list.length})</small>
                  {list.map((x) => <div className="person-row" key={x.user.id}><Avatar name={x.user.name || x.user.email} /><span><b>{x.user.name || x.user.email}</b><small>{fmtDateTime(x.at)}</small></span><Ticks status={kind} /></div>)}
                  {!list.length && <small className="muted">Nobody yet.</small>}
                </div>
              ))}
              {info && info.pending.length > 0 && <div className="info-group"><small>Not delivered yet ({info.pending.length})</small>{info.pending.map((u) => <div className="person-row" key={u.id}><Avatar name={u.name || u.email} /><span><b>{u.name || u.email}</b><small>Offline since sending</small></span></div>)}</div>}
            </div>
          </div>
        </div>
      )}
      {inviting && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setInviting(false)}>
          <div className="modal">
            <div className="modal-head"><span><small>TICKET DISCUSSION</small><h2>Invite people</h2></span><button type="button" onClick={() => setInviting(false)}><X /></button></div>
            <div className="modal-body">
              <div className="field"><label>Whole teams</label><TeamMultiSelect teams={allTeams} value={inviteTeams} onChange={setInviteTeams} label="Invite teams" /></div>
              <small className="win-label">People</small>
              {others.filter((u) => !members.some((m) => m.id === u.id)).map((u) => (
                <label key={u.id} className="person-row pick">
                  <input type="checkbox" checked={inviteUsers.includes(u.id)} onChange={() => setInviteUsers((cur) => (cur.includes(u.id) ? cur.filter((x) => x !== u.id) : [...cur, u.id]))} />
                  <Avatar name={u.name || u.email} /><span><b>{u.name || u.email}</b><small>{u.email}</small></span>
                </label>
              ))}
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}><button type="button" className="primary" disabled={!inviteUsers.length && !inviteTeams.length} onClick={sendInvite}>Add to discussion</button></div>
            </div>
          </div>
        </div>
      )}
      {dragging && <div className="tc-drop" aria-hidden="true">Drop files to attach</div>}
    </section>
  );
}
