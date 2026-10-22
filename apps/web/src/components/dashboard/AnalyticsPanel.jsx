import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import Panel from "../ui/Panel";
import { STATUSES, STATUS_LABEL } from "../../lib/ticketStatus";
import "../../styles/status.css";

const iso = (d) => d.toISOString().slice(0, 10);
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
const stat = (label, value, hint) => (
  <div className="win-card" style={{ padding: "10px 14px", minWidth: 140 }} key={label} title={hint}>
    <small className="hint">{label}</small><b style={{ fontSize: 22 }}>{value ?? "—"}</b>
  </div>
);

// Ticket status cards (click = open that list), plus opened/closed analytics for a date range, per month.
export default function AnalyticsPanel({ staff }) {
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))));
  const [to, setTo] = useState(iso(now));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    api.get("/analytics", { params: { from, to } }).then((r) => { if (live) { setData(r.data); setErr(""); } }).catch((e) => { if (live) setErr(e.response?.data?.error || "Could not load analytics"); });
    return () => { live = false; };
  }, [from, to]);

  const preset = (kind) => {
    const n = new Date();
    if (kind === "month") setFrom(iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))));
    if (kind === "3m") setFrom(iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 2, 1))));
    if (kind === "year") setFrom(iso(new Date(Date.UTC(n.getUTCFullYear(), 0, 1))));
    setTo(iso(n));
  };
  const max = Math.max(1, ...(data?.months || []).flatMap((m) => [m.opened, m.closed]));
  const t = data?.tickets, k = data?.tasks;

  return (
    <>
      <div className="metrics">
        {STATUSES.map((s) => (
          <Link key={s} to={`/tickets?status=${s}`} className="metric" style={{ textDecoration: "none", color: "inherit" }} title={`Show ${STATUS_LABEL[s]} tickets`}>
            <span className={`status s-${s.toLowerCase().replaceAll("_", "-")}`}>● {STATUS_LABEL[s]}</span>
            <b style={{ fontSize: 30, display: "block" }}>{data?.status?.[s] ?? "…"}</b>
            <small className="hint">tickets · click to view</small>
          </Link>
        ))}
      </div>
      <Panel title="Ticket analytics" sub="A clearer view of workload, turnaround and overdue work across your selected date range">
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <label className="hint">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="hint">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="secondary" onClick={() => preset("month")}>This month</button>
          <button className="secondary" onClick={() => preset("3m")}>Last 3 months</button>
          <button className="secondary" onClick={() => preset("year")}>This year</button>
        </div>
        {err && <p className="hint">{err}</p>}
        {data && (
          <>
            <div className="row analytics-summary" style={{ flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>
              {stat("Opened in range", t.opened)}{stat("Closed in range", t.closed)}
              {stat("Avg days to close", t.avgDaysToClose, "Average days from opening to closing, for tickets closed in this range")}
              {stat("Avg days open now", t.avgDaysOpen, "Average age of tickets that are not closed yet")}
              {stat("Overdue", t.overdue, "Not closed and past the due date")}
              {staff && k && <>{stat("Open tasks", k.open)}{stat("Overdue tasks", k.overdue)}{stat("Tasks done in range", k.done)}{stat("Avg days to finish a task", k.avgDaysToDone)}</>}
            </div>
            <div className="ticket-analytics-chart" style={{ display: "flex", gap: 12, alignItems: "flex-end", minHeight: 190, marginTop: 20, overflowX: "auto", padding: "16px 12px 8px", borderRadius: 12, background: "var(--surface-subtle, rgba(127,127,127,.06))" }} role="img" aria-label="Tickets opened and closed per month">
              {data.months.map((m) => (
                <div key={m.month} style={{ textAlign: "center", minWidth: 62, flex: "1 0 62px" }}>
                  <div style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 132, justifyContent: "center", borderBottom: "1px solid var(--border, #ddd)" }}>
                    <div title={`${m.opened} opened`} style={{ width: 18, height: `${(m.opened / max) * 100}%`, minHeight: m.opened ? 3 : 0, background: "#5746e8", borderRadius: "4px 4px 0 0" }} />
                    <div title={`${m.closed} closed`} style={{ width: 18, height: `${(m.closed / max) * 100}%`, minHeight: m.closed ? 3 : 0, background: "#0f9d8a", borderRadius: "4px 4px 0 0" }} />
                  </div>
                  <small className="hint">{monthName(m.month)}</small><small style={{ display: "block" }}>{m.opened} / {m.closed}</small>
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 14, flexWrap: "wrap", marginTop: 10 }}><small className="hint"><i style={{ background: "#5746e8", display: "inline-block", width: 10, height: 10, borderRadius: 3 }} /> Opened</small><small className="hint"><i style={{ background: "#0f9d8a", display: "inline-block", width: 10, height: 10, borderRadius: 3 }} /> Closed (per month)</small></div>
          </>
        )}
      </Panel>
    </>
  );
}
