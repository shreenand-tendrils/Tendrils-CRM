import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Inbox, CheckCircle2, Timer, Hourglass, AlertTriangle, ListTodo, ListChecks, Gauge, LifeBuoy, SearchCheck, Lock, FolderOpen, FolderKanban } from "lucide-react";
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
export default function AnalyticsPanel({ staff, projects }) {
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
      <div className="kpi-grid status-cards">
        {STATUSES.map((s) => (
          <Link key={s} to={`/tickets?status=${s}`} className="kpi status-card" title={`Show ${(staff ? STATUS_LABEL : CLIENT_LABEL)[s]} tickets`}>
            <i className={`kpi-icon st-${s.toLowerCase().replaceAll("_", "-")}`}>{(() => { const I = STATUS_ICON[s]; return <I size={17} />; })()}</i>
            <span className="kpi-label">{(staff ? STATUS_LABEL : CLIENT_LABEL)[s]}</span>
            <b className="kpi-value">{data?.status?.[s] ?? "…"}</b>
            <small className="kpi-hint">tickets · view list</small>
          </Link>
        ))}
      </div>

      <div className="analytics-head">
        <div><h3>Ticket analytics</h3><p>Workload, turnaround and overdue work for the selected period</p></div>
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
            <Kpi icon={Inbox} tone="violet" label="Opened" value={t.opened} hint="in this period" />
            <Kpi icon={CheckCircle2} tone="green" label="Closed" value={t.closed} hint="in this period" />
            <Kpi icon={Timer} tone="blue" label="Avg time to close" value={days(t.avgDaysToClose)} hint="opening → closing" />
            <Kpi icon={Hourglass} tone="amber" label="Avg age (open)" value={days(t.avgDaysOpen)} hint="tickets not closed yet" />
            <Kpi icon={AlertTriangle} tone="rose" label="Overdue tickets" value={t.overdue} hint="past due, not closed" to="/tickets?overdue=1" />
            {staff && projects != null && <Kpi icon={FolderKanban} tone="violet" label="Active projects" value={projects} hint="across your workspaces" to="/projects" />}
            {staff && k && <>
              <Kpi icon={ListTodo} tone="blue" label="Open tasks" value={k.open} hint="work in motion" to="/tasks" />
              <Kpi icon={AlertTriangle} tone="rose" label="Overdue tasks" value={k.overdue} hint="need a follow-up" to="/tasks" />
              <Kpi icon={ListChecks} tone="green" label="Tasks done" value={k.done} hint="in this period" />
              <Kpi icon={Gauge} tone="violet" label="Avg time per task" value={days(k.avgDaysToDone)} hint="start → done" />
            </>}
          </div>

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
