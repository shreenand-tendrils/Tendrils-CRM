import { useMemo, useState } from "react";
import { Megaphone, Users, User, Globe2, X, Bell, Mail, AlertTriangle, Send } from "lucide-react";
import { api } from "../../api";
import { can } from "../../lib/rbac";
import Avatar from "../ui/Avatar";
import "../../styles/broadcast.css";

const nameOf = (u) => u?.name || u?.email || "Member";

/** Send an announcement (everyone), or ping teams / specific people. Delivered in-app, by email (optional) and WhatsApp for linked numbers. */
export default function BroadcastModal({ me, data, onClose, notify }) {
  const canAll = can(me, "broadcast.all");
  const [audience, setAudience] = useState(canAll ? "ALL" : "TEAMS");
  const [teamIds, setTeamIds] = useState([]);
  const [userIds, setUserIds] = useState([]);
  const [teamFilter, setTeamFilter] = useState("");
  const [q, setQ] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const teams = data.teams || [];
  const memberOf = (team) => (team.members || []).map((m) => m.membership?.user).filter(Boolean);
  const people = useMemo(() => {
    const map = new Map();
    for (const t of teams) for (const u of memberOf(t)) { if (!map.has(u.id)) map.set(u.id, { ...u, teamIds: [], teamNames: [] }); map.get(u.id).teamIds.push(t.id); map.get(u.id).teamNames.push(t.name); }
    for (const u of data.users || []) if (!map.has(u.id)) map.set(u.id, { ...u, teamIds: [], teamNames: [] });
    map.delete(me.user.id);
    return [...map.values()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [teams, data.users, me.user.id]);
  const shown = people.filter((u) => (!teamFilter || u.teamIds.includes(teamFilter)) && (!q || `${nameOf(u)} ${u.email || ""}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const teamPeople = new Set(teams.filter((t) => teamIds.includes(t.id)).flatMap((t) => memberOf(t).map((u) => u.id)));
  teamPeople.delete(me.user.id);
  const recipients = audience === "ALL" ? null : new Set([...(audience === "PEOPLE" ? [] : teamPeople), ...(audience === "TEAMS" ? [] : userIds)]).size;
  const ready = title.trim().length >= 2 && message.trim().length >= 2 && (audience === "ALL" || recipients > 0);
  const toLabel = audience === "ALL" ? "everyone" : audience === "TEAMS" ? teams.filter((t) => teamIds.includes(t.id)).map((t) => t.name).join(", ") || "your teams" : "you";
  const sender = me.user.name || me.user.email;

  const send = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api.post("/broadcasts", { audience, teamIds: audience === "PEOPLE" ? [] : teamIds, userIds: audience === "TEAMS" ? [] : userIds, title: title.trim(), message: message.trim(), urgent, email });
      notify?.(`Sent to ${r.data.sent} ${r.data.sent === 1 ? "person" : "people"}`);
      onClose();
    } catch (e2) { setErr(e2.response?.data?.error || "Could not send. Please try again."); setBusy(false); }
  };

  const aud = [
    ["ALL", "Everyone", "All employees and admins", Globe2, !canAll],
    ["TEAMS", "Teams", "Every member of the teams you pick", Users, false],
    ["PEOPLE", "People", "Hand-pick one or more people", User, false],
  ];
  const chosenUsers = people.filter((u) => userIds.includes(u.id));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal bc" onSubmit={send} role="dialog" aria-label="Send a message">
        <header className="bc-head">
          <span className="bc-ico"><Megaphone size={22} /></span>
          <span><b>Broadcast or ping</b><small>Reaches people in the app, by email and on WhatsApp (if linked). It does not go into chat.</small></span>
          <button type="button" className="bc-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="bc-body">
          <section>
            <h4><i>1</i> Who should get it?</h4>
            <div className="bc-aud">
              {aud.map(([id, label, hint, Icon, disabled]) => (
                <button type="button" key={id} disabled={disabled} className={audience === id ? "on" : ""} onClick={() => setAudience(id)} title={disabled ? "Only admins can message everyone" : undefined}>
                  <Icon size={20} /><b>{label}</b><small>{disabled ? "Admins only" : hint}</small>
                </button>
              ))}
            </div>

            {audience !== "ALL" && audience !== "PEOPLE" && (
              <div className="bc-box">
                <div className="bc-tools"><span>Pick teams</span><button type="button" onClick={() => setTeamIds(teams.map((t) => t.id))}>Select all</button><button type="button" onClick={() => setTeamIds([])}>Clear</button></div>
                <div className="bc-teams">
                  {teams.map((t) => (
                    <button type="button" key={t.id} className={teamIds.includes(t.id) ? "on" : ""} onClick={() => toggle(teamIds, setTeamIds, t.id)}><b>{t.name}</b><small>{memberOf(t).length} members</small></button>
                  ))}
                  {!teams.length && <small>No teams found.</small>}
                </div>
              </div>
            )}

            {audience === "PEOPLE" && (
              <div className="bc-box">
                <div className="bc-tools">
                  <select aria-label="Filter by team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}><option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                  <input aria-label="Search people" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
                  <button type="button" onClick={() => setUserIds([...new Set([...userIds, ...shown.map((u) => u.id)])])}>Select shown</button>
                  <button type="button" onClick={() => setUserIds([])}>Clear</button>
                </div>
                {chosenUsers.length > 0 && <div className="bc-chips">{chosenUsers.map((u) => <span key={u.id}>{nameOf(u)}<button type="button" aria-label={`Remove ${nameOf(u)}`} onClick={() => toggle(userIds, setUserIds, u.id)}><X size={12} /></button></span>)}</div>}
                <div className="bc-people">
                  {shown.map((u) => (
                    <label key={u.id} className={userIds.includes(u.id) ? "on" : ""}>
                      <input type="checkbox" checked={userIds.includes(u.id)} onChange={() => toggle(userIds, setUserIds, u.id)} />
                      <Avatar name={nameOf(u)} /><span><b>{nameOf(u)}</b><small>{u.teamNames?.join(", ") || u.email}</small></span>
                    </label>
                  ))}
                  {!shown.length && <small style={{ padding: 8 }}>No one matches.</small>}
                </div>
              </div>
            )}
            <div className="bc-count">{audience === "ALL" ? "Everyone on the team side will receive this." : recipients ? `${recipients} ${recipients === 1 ? "person" : "people"} will receive this.` : "Nobody selected yet."}</div>
          </section>

          <section>
            <h4><i>2</i> What do you want to say?</h4>
            <div className="field"><label htmlFor="bc-title">Title <small className="bc-n">{title.length}/140</small></label><input id="bc-title" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Release at 6 PM today" /></div>
            <div className="field"><label htmlFor="bc-msg">Message <small className="bc-n">{message.length}/2000</small></label><textarea id="bc-msg" rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write the details. Links become clickable." /></div>
          </section>

          <section>
            <h4><i>3</i> How should it arrive?</h4>
            <div className="bc-opts">
              <label className={email ? "on" : ""}><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /><Mail size={18} /><span><b>Also send email</b><small>In-app and WhatsApp always go out</small></span></label>
              <label className={urgent ? "on warn" : ""}><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /><AlertTriangle size={18} /><span><b>Mark as urgent</b><small>Adds URGENT to the title</small></span></label>
            </div>
            <div className="bc-preview" aria-label="Preview">
              <small>Preview of what they see</small>
              <div><Bell size={18} /><span><b>{urgent ? "URGENT: " : ""}{title.trim() || "Your title"}</b><em>{sender} (to {toLabel}): {message.trim().slice(0, 140) || "Your message"}</em></span></div>
            </div>
          </section>
          {err && <p role="alert" className="bc-err">{err}</p>}
        </div>

        <footer className="bc-foot">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!ready || busy}><Send size={15} /> {busy ? "Sending..." : recipients ? `Send to ${recipients}` : "Send message"}</button>
        </footer>
      </form>
    </div>
  );
}
