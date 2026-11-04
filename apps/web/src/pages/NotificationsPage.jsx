import { useMemo, useState } from "react";
import { Bell } from "lucide-react";
import Panel from "../components/ui/Panel";
import { api } from "../api";

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
      <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <button className={`chip ${tab === "unread" ? "on" : ""}`} onClick={() => { setTab("unread"); setShown(PAGE); }}>Unread ({unread})</button>
        <button className={`chip ${tab === "all" ? "on" : ""}`} onClick={() => { setTab("all"); setShown(PAGE); }}>All ({items.length})</button>
        {unread > 0 && <button className="secondary" onClick={() => api.post("/notifications/read-all").then(onRefresh)}>Mark all as read</button>}
        {items.some((n) => n.readAt) && <button className="secondary" onClick={() => api.delete("/notifications/read").then(onRefresh)}>Clear read</button>}
      </div>
      {rows.slice(0, shown).map((n) => (
        <div className="notification" key={n.id} style={n.unreadIds.length ? undefined : { opacity: 0.65 }}>
          <Bell />
          <span><b>{n.title}{n.count > 1 ? ` (x${n.count})` : ""}</b><small>{n.body} · {new Date(n.createdAt).toLocaleString()}</small></span>
          {n.unreadIds.length > 0 && <button className="secondary" onClick={() => markRows(n.unreadIds)}>Mark read</button>}
        </div>
      ))}
      {rows.length > shown && <button className="secondary" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button>}
      {!rows.length && <p style={{ color: "#888" }}>{tab === "unread" ? "You're all caught up." : "No notifications yet."}</p>}
    </Panel>
  );
}
