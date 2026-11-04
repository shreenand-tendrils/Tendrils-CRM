import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Inbox, CheckCircle2, Timer, AlertTriangle, ListTodo, ListChecks, LifeBuoy, SearchCheck, Lock, FolderOpen } from "lucide-react";
import { api } from "../../api";
import { on } from "../../lib/realtime";
import RangePicker, { presetRange } from "../ui/RangePicker";
import { STATUSES, STATUS_LABEL } from "../../lib/ticketStatus";
import "../../styles/status.css";
import "../../styles/analytics.css";

const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
// Clients read plain wording instead of the staff status names.
const CLIENT_LABEL = { OPEN: "Open", REVIEW_TEST: "Needs your review", REVIEW_HELP: "We need info from you", CLOSED: "Closed" };
const STATUS_ICON = { OPEN: FolderOpen, REVIEW_TEST: SearchCheck, REVIEW_HELP: LifeBuoy, CLOSED: Lock };

function Kpi({ icon: Icon, tone = "violet", label, value, hint, to }) {
  const body = (
    <>
      <i className={`kpi-icon ${tone}`}><Icon size={17} /></i>
      <span className="kpi-label">{label}</span>
      <b className="kpi-value">{value ?? "—"}</b>
      <small className="kpi-hint">{hint}</small>
    </>
  );
  return to ? <Link className="kpi" to={to}>{body}</Link> : <div className="kpi">{body}</div>;
}

// Ticket status cards (click = open that list) + range analytics, all as cards. The range is one small picker.
export default function AnalyticsPanel({ staff }) {
  const [range, setRange] = useState(() => presetRange("6m"));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [scope, setScope] = useState("all"); // "all" = everything this person can see, "mine" = only their own work
  const [tick, setTick] = useState(0);
  useEffect(() => on("app.refresh", () => setTick((n) => n + 1)), []); // Refresh button + automatic refresh
  useEffect(() => {
    let live = true;
    api.get("/analytics", { params: { ...range, scope } }).then((r) => { if (live) { setData(r.data); setErr(""); } }).catch((e) => { if (live) setErr(e.response?.data?.error || "Could not load analytics"); });
    return () => { live = false; };
  }, [range.from, range.to, scope, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = data?.tickets, k = data?.tasks;
  const max = Math.max(1, ...(data?.months || []).flatMap((m) => [m.opened, m.closed]));
  const days = (v) => (v == null ? "—" : `${v}d`);

  return (
    <section className="analytics" aria-label="Ticket analytics">
      <div className="analytics-section-head">
        <div><h3>Current ticket queue</h3><p>Live snapshot of tickets by their current status</p></div>
      </div>
      <div className="kpi-grid status-cards">
        {STATUSES.map((s) => (
          <Link key={s} to={`/tickets?status=${s}${scope === "mine" ? "&view=mine" : ""}`} className="kpi status-card" title={`Show ${(staff ? STATUS_LABEL : CLIENT_LABEL)[s]} tickets`}>
            <i className={`kpi-icon st-${s.toLowerCase().replaceAll("_", "-")}`}>{(() => { const I = STATUS_ICON[s]; return <I size={17} />; })()}</i>
            <span className="kpi-label">{(staff ? STATUS_LABEL : CLIENT_LABEL)[s]}</span>
            <b className="kpi-value">{data?.status?.[s] ?? "…"}</b>
            <small className="kpi-hint">currently in this status · view</small>
          </Link>
        ))}
      </div>

      <div className="analytics-head">
        <div><h3>Activity &amp; workload</h3><p>{scope === "mine" ? "Your assigned and raised work" : "Everything available within your team and workspace access"} · {range.from} to {range.to}</p></div>
        <div className="analytics-tools">
          <div className="seg" role="group" aria-label="Whose numbers">
            <button type="button" className={scope === "all" ? "on" : ""} aria-pressed={scope === "all"} onClick={() => setScope("all")}>{staff ? "Everything I can see" : "All my company"}</button>
            <button type="button" className={scope === "mine" ? "on" : ""} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>Only mine</button>
          </div>
          <RangePicker from={range.from} to={range.to} onChange={setRange} />
        </div>
      </div>
      {err && <p className="hint">{err}</p>}
      {data && (
        <>
          <div className="kpi-grid">
            <Kpi icon={Inbox} tone="violet" label="New tickets" value={t.opened} hint="tickets created in this period" />
            <Kpi icon={CheckCircle2} tone="green" label="Tickets closed" value={t.closed} hint="closure recorded in this period" />
            <Kpi icon={Timer} tone="blue" label="Avg. resolution" value={days(t.avgDaysToClose)} hint="creation → closure" />
            <Kpi icon={AlertTriangle} tone="rose" label="Overdue tickets" value={t.overdue} hint="currently past due" to={`/tickets?overdue=1${scope === "mine" ? "&mine=1" : ""}`} />
            {staff && k && <>
              <Kpi icon={ListTodo} tone="blue" label="Open tasks" value={k.open} hint="currently in progress" to={`/tasks${scope === "mine" ? "?mine=1" : ""}`} />
              <Kpi icon={AlertTriangle} tone="rose" label="Overdue tasks" value={k.overdue} hint="currently past due" to={`/tasks${scope === "mine" ? "?mine=1" : ""}`} />
              <Kpi icon={ListChecks} tone="green" label="Tasks completed" value={k.done} hint="completed in this period" />
            </>}
          </div>

          {t.closedWithoutTimestamp > 0 && <p className="analytics-note">{t.closedWithoutTimestamp} currently closed {t.closedWithoutTimestamp === 1 ? "ticket has" : "tickets have"} no recorded closure date, so {t.closedWithoutTimestamp === 1 ? "its" : "their"} historical closure is not included in the selected-period totals.</p>}
          <div className="chart-card">
            <div className="chart-head">
              <b>Opened vs closed per month</b>
              <span className="legend"><i className="dot open" /> Opened <i className="dot done" /> Closed</span>
            </div>
            <div className="bars" role="img" aria-label="Tickets opened and closed per month">
              {data.months.map((m) => (
                <div className="bar-col" key={m.month}>
                  <div className="bar-pair">
                    <div className="bar open" title={`${m.opened} opened`} style={{ height: `${(m.opened / max) * 100}%`, minHeight: m.opened ? 3 : 0 }} />
                    <div className="bar done" title={`${m.closed} closed`} style={{ height: `${(m.closed / max) * 100}%`, minHeight: m.closed ? 3 : 0 }} />
                  </div>
                  <small>{monthName(m.month)}</small>
                  <small className="nums">{m.opened} / {m.closed}</small>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
