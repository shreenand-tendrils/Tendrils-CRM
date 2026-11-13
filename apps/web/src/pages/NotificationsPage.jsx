import { useMemo, useState } from "react";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import Panel from "../components/ui/Panel";
import { api } from "../api";
import Linkify from "../components/ui/Linkify";
import ShowMore from "../components/ui/ShowMore";
import { fmtDateTime } from "../lib/dates";

const PAGE = 10;

export default function NotificationsPage({ data, onRefresh }) {
  const items = data.notifications || [];
  const [tab, setTab] = useState("unread");
  const [shown, setShown] = useState(PAGE);
  const unread = items.filter((n) => !n.readAt).length;
  // Identical notifications are merged into one row with a count so the list stays short.
  const rows = useMemo(() => {
    const map = new Map();
    for (const n of items.filter((x) => tab === "all" || !x.readAt)) {
      const k = `${n.title}|${n.body}|${n.href || ""}`;
      const r = map.get(k);
      if (r) { r.count += 1; if (!n.readAt) r.unreadIds.push(n.id); }
      else map.set(k, { ...n, count: 1, unreadIds: n.readAt ? [] : [n.id] });
    }
    return [...map.values()];
  }, [items, tab]);
  const markRows = (ids) => Promise.all(ids.map((id) => api.patch(`/notifications/${id}/read`))).then(onRefresh);

  return (
    <Panel title="Your notifications" sub={`${unread} unread`}>
      <div className="nt-toolbar">
        <div className="seg" role="tablist" aria-label="Notification filter">
          <button type="button" role="tab" aria-selected={tab === "unread"} className={`seg-btn${tab === "unread" ? " on" : ""}`} onClick={() => { setTab("unread"); setShown(PAGE); }}>Unread<em>{unread}</em></button>
          <button type="button" role="tab" aria-selected={tab === "all"} className={`seg-btn${tab === "all" ? " on" : ""}`} onClick={() => { setTab("all"); setShown(PAGE); }}>All<em>{items.length}</em></button>
        </div>
        <div className="nt-actions">
          {unread > 0 && <button type="button" className="btn-soft" onClick={() => api.post("/notifications/read-all").then(onRefresh)}><CheckCheck size={15} /> Mark all as read</button>}
          {items.some((n) => n.readAt) && <button type="button" className="btn-soft danger" onClick={() => api.delete("/notifications/read").then(onRefresh)}><Trash2 size={15} /> Clear read</button>}
        </div>
      </div>
      <div className="nt-list">
        {rows.slice(0, shown).map((n) => {
          const isUnread = n.unreadIds.length > 0;
          return (
            <div className={`nt-row ${isUnread ? "unread" : "read"}`} key={n.id}>
              <span className="nt-icon"><Bell size={18} /></span>
              <div className="nt-body">
                <b>{n.title}{n.count > 1 && <em className="nt-count">×{n.count}</em>}</b>
                <p><Linkify text={n.body} /></p>
                <small>{fmtDateTime(n.createdAt)}</small>
              </div>
              {isUnread && <div className="nt-act"><button type="button" className="btn-soft sm" onClick={() => markRows(n.unreadIds)}><Check size={14} /> Mark read</button></div>}
            </div>
          );
        })}
      </div>
      {rows.length > shown && <ShowMore count={Math.min(PAGE, rows.length - shown)} onClick={() => setShown(shown + PAGE)} />}
      {!rows.length && <p className="nt-empty">{tab === "unread" ? "You're all caught up." : "No notifications yet."}</p>}
    </Panel>
  );
}
