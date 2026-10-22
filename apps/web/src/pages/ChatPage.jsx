import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Hash, FolderKanban, Plus, X, ArrowLeft, Check, CheckCheck, Pin, PinOff, Pencil, Trash2, MoreHorizontal, Ban, Reply, Info, Eye } from "lucide-react";
import Avatar from "../components/ui/Avatar";
import EmptyState from "../components/ui/EmptyState";
import { api } from "../api";
import * as realtime from "../lib/realtime";
import { tickStatus, EDIT_WINDOW_MS, nameOf } from "../lib/chatTicks";

const time = (v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const TYPING_MS = 3500;
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ✓ sent · ✓✓ delivered · blue ✓✓ read (like WhatsApp). */
function Ticks({ status }) {
  const Icon = status === "sent" ? Check : CheckCheck;
  return <span className={"ticks " + status} title={status === "read" ? "Read" : status === "delivered" ? "Delivered" : "Sent"} aria-label={status}><Icon size={15} /></span>;
}

/** Message text with @mentions highlighted. */
function Body({ text, members, meId }) {
  const names = [...members.map((u) => nameOf(u)), "everyone", "all"].sort((a, b) => b.length - a.length);
  const parts = text.split(new RegExp(`(@(?:${names.map(esc).join("|")}))(?![\\w])`, "gi"));
  return <>{parts.map((p, i) => {
    if (!p.startsWith("@")) return <span key={i}>{p}</span>;
    const w = p.slice(1).toLowerCase();
    const u = members.find((m) => nameOf(m).toLowerCase() === w);
    if (!u && w !== "all" && w !== "everyone") return <span key={i}>{p}</span>;
    return <mark key={i} className={"mention" + (!u || u.id === meId ? " me" : "")}>{p}</mark>;
  })}</>;
}

export default function ChatPage({ me, users = [], notify }) {
  const [params, setParams] = useSearchParams();
  const [rooms, setRooms] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState({}); // roomId -> { name, until }
  const [online, setOnline] = useState(realtime.getOnline());
  const [live, setLive] = useState(realtime.isOpen());
  const [picker, setPicker] = useState(false);
  const [members, setMembers] = useState([]);
  const [pins, setPins] = useState([]);
  const [receipts, setReceipts] = useState({}); // userId -> { deliveredAt, readAt } for the open room
  const [editing, setEditing] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [infoFor, setInfoFor] = useState(null); // message whose delivery info is open
  const [info, setInfo] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [showPins, setShowPins] = useState(false);
  const mentionMap = useRef({}); // "@Name" typed via the picker -> user id
  const inputRef = useRef(null);
  const bottom = useRef(null);
  const pending = useRef(new Map()); // tempId -> body (restored if the server rejects it)
  const lastTyped = useRef(0);
  const meId = me.user.id;

  const activeId = params.get("room") || rooms?.find((r) => r.type === "GENERAL")?.id || rooms?.[0]?.id;
  const active = rooms?.find((r) => r.id === activeId);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const loadRooms = useCallback(() => api.get("/chat/rooms").then((r) => setRooms(r.data)).catch(() => notify("Could not load chat rooms", "error")), [notify]);
  const markRead = useCallback((roomId) => {
    if (!roomId) return;
    setRooms((rs) => rs?.map((r) => (r.id === roomId ? { ...r, unread: 0 } : r)));
    if (!realtime.send({ type: "chat.read", roomId })) api.post(`/chat/rooms/${roomId}/read`).then(() => realtime.emit("chat.unread.refresh")).catch(() => {});
  }, []);
  const merge = useCallback((incoming) => setMessages((cur) => {
    const seen = new Set(cur.map((m) => m.id));
    const add = incoming.filter((m) => !seen.has(m.id));
    return add.length ? [...cur, ...add] : cur;
  }), []);
  const loadMessages = useCallback((roomId) => api.get(`/chat/rooms/${roomId}/messages`).then((r) => { setMessages(r.data); markRead(roomId); }).catch(() => {}), [markRead]);

  useEffect(() => { loadRooms(); }, [loadRooms]);
  const loadRoomExtras = useCallback((roomId) => {
    api.get(`/chat/rooms/${roomId}/members`).then((r) => setMembers(r.data)).catch(() => setMembers([]));
    api.get(`/chat/rooms/${roomId}/pins`).then((r) => setPins(r.data)).catch(() => setPins([]));
    api.get(`/chat/rooms/${roomId}/receipts`).then((r) => setReceipts(Object.fromEntries(r.data.map((x) => [x.userId, x])))).catch(() => setReceipts({}));
  }, []);
  useEffect(() => {
    setMessages([]); setEditing(null); setReplyTo(null); setMenuFor(null); setShowPins(false); setPins([]); setReceipts({}); mentionMap.current = {};
    if (activeId) { loadMessages(activeId); loadRoomExtras(activeId); }
  }, [activeId, loadMessages, loadRoomExtras]);

  // Live events
  useEffect(() => {
    const offs = [
      realtime.on("chat.message", ({ message }) => {
        const isActive = message.roomId === activeRef.current;
        if (isActive) {
          merge([message]);
          if (message.authorId !== meId && !document.hidden) markRead(message.roomId);
          setTyping((t) => { const { [message.roomId]: _, ...rest } = t; return rest; });
        }
        setRooms((rs) => {
          if (!rs || !rs.some((r) => r.id === message.roomId)) { loadRooms(); return rs; } // e.g. someone started a DM with you
          return rs.map((r) => r.id === message.roomId ? { ...r, lastMessage: message, unread: isActive && !document.hidden || message.authorId === meId ? 0 : r.unread + 1 } : r);
        });
      }),
      realtime.on("chat.typing", ({ roomId, userId, name }) => {
        if (userId === meId) return;
        setTyping((t) => ({ ...t, [roomId]: { name, until: Date.now() + TYPING_MS } }));
        setTimeout(() => setTyping((t) => (t[roomId] && t[roomId].until <= Date.now() ? (({ [roomId]: _, ...rest }) => rest)(t) : t)), TYPING_MS + 100);
      }),
      realtime.on("chat.message.updated", ({ message }) => {
        if (message.roomId === activeRef.current) {
          setMessages((cur) => cur.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
          setPins((cur) => { const rest = cur.filter((p) => p.id !== message.id); return message.pinnedAt && !message.deletedAt ? [{ ...message }, ...rest].sort((a, b) => new Date(b.pinnedAt) - new Date(a.pinnedAt)) : rest; });
        }
        setRooms((rs) => rs?.map((r) => (r.lastMessage?.id === message.id ? { ...r, lastMessage: { ...r.lastMessage, ...message } } : r)));
      }),
      realtime.on("chat.receipt", ({ roomId, userId, kind, at }) => {
        if (roomId !== activeRef.current || userId === meId) return;
        setReceipts((cur) => ({ ...cur, [userId]: { ...cur[userId], userId, [kind === "read" ? "readAt" : "deliveredAt"]: at } }));
      }),
      realtime.on("chat.read", ({ roomId }) => setRooms((rs) => rs?.map((r) => (r.id === roomId ? { ...r, unread: 0 } : r)))),
      realtime.on("chat.error", ({ tempId, error }) => {
        notify(error || "Message not sent", "error");
        const body = pending.current.get(tempId);
        if (body) { pending.current.delete(tempId); setDraft((d) => d || body); }
      }),
      realtime.on("chat.ack", ({ tempId }) => pending.current.delete(tempId)),
      realtime.on("presence", (set) => setOnline(new Set(set))),
      realtime.on("open", () => { setLive(true); loadRooms(); if (activeRef.current) { loadMessages(activeRef.current); loadRoomExtras(activeRef.current); } }), // catch up after a reconnect
      realtime.on("close", () => setLive(false)),
    ];
    return () => offs.forEach((off) => off());
  }, [meId, merge, markRead, loadRooms, loadMessages, loadRoomExtras, notify]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length, activeId]);
  useEffect(() => { // mark read when the tab becomes visible again
    const onVisible = () => !document.hidden && activeRef.current && markRead(activeRef.current);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  const mentionIdsFor = (body) => [...new Set(Object.entries(mentionMap.current).filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id))];

  const send = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !activeId) return;
    if (editing) { // edit an existing message (author, within 15 minutes)
      try {
        const { data } = await api.patch(`/chat/messages/${editing.id}`, { body });
        setMessages((cur) => cur.map((m) => (m.id === data.id ? { ...m, ...data } : m)));
        setEditing(null); setDraft("");
      } catch (err) { notify(err.response?.data?.error || "Could not edit message", "error"); }
      return;
    }
    const mentionIds = mentionIdsFor(body);
    const replyToId = replyTo?.id;
    setDraft(""); setReplyTo(null); mentionMap.current = {};
    const tempId = crypto.randomUUID();
    pending.current.set(tempId, body);
    if (realtime.send({ type: "chat.send", roomId: activeId, body, mentionIds, replyToId, tempId })) return; // echo arrives via "chat.message"
    try { // WebSocket down: fall back to REST (the server still broadcasts it)
      const { data } = await api.post(`/chat/rooms/${activeId}/messages`, { body, mentionIds, replyToId });
      merge([data]);
      pending.current.delete(tempId);
    } catch (err) {
      notify(err.response?.data?.error || "Message not sent", "error");
      setDraft((d) => d || body);
    }
  };

  const startEdit = (m) => { setMenuFor(null); setEditing(m); setDraft(m.body); setTimeout(() => inputRef.current?.focus(), 0); };
  const startReply = (m) => { setMenuFor(null); setEditing(null); setReplyTo(m); setTimeout(() => inputRef.current?.focus(), 0); };
  const openInfo = (m) => { setMenuFor(null); setInfoFor(m); setInfo(null); api.get(`/chat/messages/${m.id}/info`).then((r) => setInfo(r.data)).catch((err) => { notify(err.response?.data?.error || "Could not load info", "error"); setInfoFor(null); }); };
  const cancelEdit = () => { setEditing(null); setDraft(""); };
  const togglePin = (m) => { setMenuFor(null); api[m.pinnedAt ? "delete" : "put"](`/chat/messages/${m.id}/pin`).catch((err) => notify(err.response?.data?.error || "Could not update pin", "error")); };
  const remove = (m) => { setMenuFor(null); if (window.confirm("Delete this message for everyone?")) api.delete(`/chat/messages/${m.id}`).catch((err) => notify(err.response?.data?.error || "Could not delete", "error")); };
  const jumpTo = (id) => { setShowPins(false); const el = document.getElementById(`msg-${id}`); el?.scrollIntoView({ block: "center", behavior: "smooth" }); el?.classList.add("flash"); setTimeout(() => el?.classList.remove("flash"), 1600); };
  const pickMention = (u) => { const n = nameOf(u); if (u.id !== "*") mentionMap.current[n] = u.id; setDraft((d) => d.replace(/@([\w.-]*)$/, `@${n} `)); inputRef.current?.focus(); };

  const onType = (e) => {
    setDraft(e.target.value);
    if (activeId && Date.now() - lastTyped.current > 2500) { lastTyped.current = Date.now(); realtime.send({ type: "chat.typing", roomId: activeId }); }
  };

  const startDm = async (userId) => {
    setPicker(false);
    try {
      const { data } = await api.post("/chat/dm", { userId });
      await loadRooms();
      setParams({ room: data.id });
    } catch (err) { notify(err.response?.data?.error || "Could not start conversation", "error"); }
  };

  if (!rooms) return <small className="muted">Loading chat…</small>;
  if (!rooms.length) return <EmptyState icon={<Hash />} title="No chat rooms yet" text="The General room and your project rooms appear here." />;

  const section = (title, list, action) => (
    <div className="room-section">
      <div className="room-title"><small>{title}</small>{action}</div>
      {list.map((r) => (
        <button key={r.id} className={"room" + (r.id === activeId ? " on" : "")} onClick={() => setParams({ room: r.id })}>
          {r.type === "GENERAL" ? <Hash size={15} /> : r.type === "PROJECT" ? <FolderKanban size={15} /> : <span className="dm-dot-wrap"><Avatar name={r.name} /><i className={"dot" + (online.has(r.dmUser?.id) ? " on" : "")} /></span>}
          <span><b>{r.name}</b><small>{r.lastMessage ? `${r.lastMessage.authorId === meId ? "You" : r.lastMessage.author?.name || "Someone"}: ${r.lastMessage.deletedAt ? "Message deleted" : r.lastMessage.body}` : r.type === "PROJECT" ? r.project?.organization?.name : "No messages yet"}</small></span>
          {r.unread > 0 && <em className="badge">{r.unread > 99 ? "99+" : r.unread}</em>}
        </button>
      ))}
    </div>
  );
  const byActivity = (a, b) => new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0);
  const dms = rooms.filter((r) => r.type === "DIRECT").sort(byActivity);
  const others = users.filter((u) => u.id !== meId);
  const mq = /(?:^|\s)@([\w.-]*)$/.exec(draft);
  const mentionQuery = !editing && mq ? mq[1].toLowerCase() : null;
  const allOption = { id: "*", name: "all", email: "Notify everyone in this room" };
  const suggestions = mentionQuery === null ? [] : [...(active?.type !== "DIRECT" && ("all".startsWith(mentionQuery) || "everyone".startsWith(mentionQuery)) ? [allOption] : []), ...members.filter((u) => u.id !== meId && (nameOf(u).toLowerCase().includes(mentionQuery) || (u.email || "").toLowerCase().includes(mentionQuery)))].slice(0, 5);
  const t = typing[activeId];
  const typingNow = t && t.until > Date.now() ? t.name : null;

  return (
    <div className={"chat" + (params.get("room") ? " has-room" : "")}>
      <aside className="chat-rooms">
        {section("CHANNELS", rooms.filter((r) => r.type === "GENERAL"))}
        {section("PROJECTS", rooms.filter((r) => r.type === "PROJECT").sort((a, b) => a.name.localeCompare(b.name)))}
        {section("DIRECT MESSAGES", dms, <button className="icon-btn" title="New message" onClick={() => setPicker(true)}><Plus size={14} /></button>)}
        {!dms.length && <small className="muted pad">Start a conversation with + above.</small>}
      </aside>
      <section className="chat-main">
        <header>
          <button className="back" onClick={() => setParams({})} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
          <div><b>{active?.type === "GENERAL" ? "# " : ""}{active?.name}</b>
          <small>
            {active?.type === "DIRECT" ? (online.has(active.dmUser?.id) ? "● Online" : "Offline") : active?.type === "PROJECT" ? "Project team + Platform admins" : "All Tendrils staff"}
            {" · "}<span className={live ? "live" : "offline"}>{live ? "Live" : "Reconnecting…"}</span>
          </small></div>
        </header>
        {pins.length > 0 && (
          <div className="pinbar">
            <button className="pin-main" onClick={() => jumpTo(pins[0].id)} title="Go to pinned message"><Pin size={14} /><span><b>{pins.length > 1 ? `Pinned (${pins.length})` : "Pinned"}</b> {pins[0].body}</span></button>
            {pins.length > 1 && <button className="icon-btn" onClick={() => setShowPins((v) => !v)} aria-label="Show all pinned messages"><MoreHorizontal size={16} /></button>}
            {showPins && <div className="pin-list">{pins.map((p) => <div key={p.id}><button onClick={() => jumpTo(p.id)}><b>{nameOf(p.author)}</b> {p.body}</button><button className="icon-btn" aria-label="Unpin" onClick={() => togglePin(p)}><PinOff size={14} /></button></div>)}</div>}
          </div>
        )}
        <div className="chat-log">
          {messages.map((m) => {
            const own = m.authorId === meId;
            const deleted = !!m.deletedAt;
            const canEdit = own && !deleted && Date.now() - new Date(m.createdAt).getTime() <= EDIT_WINDOW_MS;
            const canDelete = !deleted && (own || me.isManager);
            const mentionsMe = (m.mentionIds || []).includes(meId);
            return (
              <div key={m.id} id={`msg-${m.id}`} className={"msg" + (own ? " own" : "") + (mentionsMe ? " pinged" : "")}>
                {!own && <Avatar name={m.author?.name || m.author?.email} />}
                <div className="bubble-wrap">
                  <small>{own ? "You" : m.author?.name || m.author?.email} · {time(m.createdAt)}{m.editedAt && !deleted ? " · edited" : ""}{m.pinnedAt && !deleted ? " · 📌" : ""}</small>
                  {!deleted && m.replyTo && (
                    <button type="button" className="quote" onClick={() => jumpTo(m.replyTo.id)} aria-label="Go to the original message">
                      <b>{m.replyTo.authorId === meId ? "You" : nameOf(m.replyTo.author)}</b>
                      <span>{m.replyTo.deletedAt ? "This message was deleted" : m.replyTo.body}</span>
                    </button>
                  )}
                  <p className={deleted ? "gone" : ""}>
                    {deleted ? <><Ban size={13} /> This message was deleted</> : <Body text={m.body} members={members} meId={meId} />}
                    {own && !deleted && <Ticks status={tickStatus(m, Object.values(receipts))} />}
                  </p>
                  {!deleted && (
                    <div className="msg-menu">
                      <button className="icon-btn" aria-label="Message actions" onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}><MoreHorizontal size={15} /></button>
                      {menuFor === m.id && (
                        <div className="menu" role="menu">
                          <button onClick={() => startReply(m)}><Reply size={14} /> Reply</button>
                          {own && <button onClick={() => openInfo(m)}><Info size={14} /> Message info</button>}
                          <button onClick={() => togglePin(m)}>{m.pinnedAt ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin message</>}</button>
                          {canEdit && <button onClick={() => startEdit(m)}><Pencil size={14} /> Edit</button>}
                          {canDelete && <button className="danger" onClick={() => remove(m)}><Trash2 size={14} /> Delete for everyone</button>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!messages.length && <small className="muted center">No messages yet — say hello.</small>}
          <div ref={bottom} />
        </div>
        <div className="typing">{typingNow ? `${typingNow} is typing…` : ""}</div>
        {replyTo && <div className="editbar reply"><Reply size={14} /> <span>Replying to <b>{replyTo.authorId === meId ? "yourself" : nameOf(replyTo.author)}</b>: {replyTo.body.slice(0, 80)}</span> <button className="icon-btn" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
        {editing && <div className="editbar"><Pencil size={14} /> Editing message <button className="icon-btn" onClick={cancelEdit} aria-label="Cancel edit"><X size={14} /></button></div>}
        {mentionQuery !== null && suggestions.length > 0 && (
          <div className="mention-list" role="listbox" aria-label="Mention someone">
            {suggestions.map((u) => <button key={u.id} role="option" onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}><Avatar name={u.name || u.email} /><span><b>{nameOf(u)}</b><small>{u.email}</small></span></button>)}
          </div>
        )}
        <form className="chat-input" onSubmit={send}>
          <input ref={inputRef} value={draft} onChange={onType} onKeyDown={(e) => e.key === "Escape" && editing && cancelEdit()} maxLength={4000} placeholder={editing ? "Edit your message" : replyTo ? "Write a reply…" : active?.type === "DIRECT" ? `Message ${active.name}` : "Write a message… type @ to mention, @all for everyone"} aria-label="Message" />
          <button className="primary" disabled={!draft.trim()}>{editing ? <><Check size={16} /> Save</> : <><Send size={16} /> Send</>}</button>
        </form>
      </section>
      {infoFor && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setInfoFor(null)}>
          <div className="modal">
            <div className="modal-head"><span><small>MESSAGE INFO</small><h2>{infoFor.body.slice(0, 60)}</h2></span><button type="button" onClick={() => setInfoFor(null)}><X /></button></div>
            <div className="modal-body">
              {!info && <small className="muted">Loading…</small>}
              {info && [["Read by", info.readBy, "read"], ["Delivered to", info.deliveredTo, "delivered"]].map(([label, list, kind]) => (
                <div key={label} className="info-group"><small>{label} ({list.length})</small>
                  {list.map((x) => <div className="person-row" key={x.user.id}><Avatar name={x.user.name || x.user.email} /><span><b>{x.user.name || x.user.email}</b><small>{new Date(x.at).toLocaleString()}</small></span><Ticks status={kind} /></div>)}
                  {!list.length && <small className="muted">Nobody yet.</small>}
                </div>
              ))}
              {info && info.pending.length > 0 && <div className="info-group"><small>Not delivered yet ({info.pending.length})</small>{info.pending.map((u) => <div className="person-row" key={u.id}><Avatar name={u.name || u.email} /><span><b>{u.name || u.email}</b><small>Offline since sending</small></span></div>)}</div>}
              {info && <small className="muted">Read time is when the person last opened this room.</small>}
            </div>
          </div>
        </div>
      )}
      {picker && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setPicker(false)}>
          <div className="modal">
            <div className="modal-head"><span><small>DIRECT MESSAGE</small><h2>Message a teammate</h2></span><button type="button" onClick={() => setPicker(false)}><X /></button></div>
            <div className="modal-body">
              {others.map((u) => (
                <button key={u.id} className="person-row pick" onClick={() => startDm(u.id)}>
                  <span className="dm-dot-wrap"><Avatar name={u.name || u.email} /><i className={"dot" + (online.has(u.id) ? " on" : "")} /></span>
                  <span><b>{u.name || u.email}</b><small>{online.has(u.id) ? "Online" : "Offline"}</small></span>
                </button>
              ))}
              {!others.length && <small className="muted">No other staff yet.</small>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
