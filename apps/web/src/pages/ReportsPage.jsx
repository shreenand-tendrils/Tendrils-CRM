import { useEffect, useMemo, useState } from "react";
import { Download, Printer, CheckCircle2, AlertTriangle, Clock, Ticket, ListTodo } from "lucide-react";
import Panel from "../components/ui/Panel";
import MetricCard from "../components/dashboard/MetricCard";
import EmptyState from "../components/ui/EmptyState";
import { api } from "../api";

const iso = (d) => d.toISOString().slice(0, 10);
const PRESETS = [["7 days", 6], ["30 days", 29], ["90 days", 89], ["1 year", 364]];
const v = (x, suf = "") => (x === null || x === undefined ? "—" : `${x}${suf}`);
const NICE = (k) => String(k).replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function Bars({ data = {}, order }) {
  const keys = (order || Object.keys(data)).filter((k) => data[k] !== undefined);
  const max = Math.max(1, ...keys.map((k) => data[k]));
  if (!keys.length) return <small className="rep-none">No data</small>;
  return <div className="rep-bars">{keys.map((k) => <div key={k}><span>{NICE(k)}</span><i><b style={{ width: `${(data[k] / max) * 100}%` }} /></i><em>{data[k]}</em></div>)}</div>;
}

function Trend({ rows = [] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.created, r.completed]));
  if (!rows.length) return null;
  return (
    <div className="rep-trend">
      {rows.map((r) => (
        <div key={r.week} title={`Week of ${r.week}: ${r.created} created, ${r.completed} completed`}>
          <span><b className="c" style={{ height: `${(r.created / max) * 100}%` }} /><b className="d" style={{ height: `${(r.completed / max) * 100}%` }} /></span>
          <small>{r.week.slice(5)}</small>
        </div>
      ))}
      <p><i className="c" /> Created <i className="d" /> Completed</p>
    </div>
  );
}

function Table({ cols, rows }) {
  return (
    <div className="rep-table"><table><thead><tr>{cols.map((c) => <th key={c[0]}>{c[1]}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id || i}>{cols.map((c) => <td key={c[0]}>{c[2] ? c[2](r[c[0]]) : r[c[0]] ?? "—"}</td>)}</tr>)}</tbody></table></div>
  );
}

function toCsv(rep) {
  const L = [["Report", rep.label], ["From", rep.range.from.slice(0, 10)], ["To", rep.range.to.slice(0, 10)], []];
  const sec = (name, obj) => { L.push([name]); Object.entries(obj).forEach(([k, val]) => L.push([NICE(k), typeof val === "object" && val ? JSON.stringify(val) : val ?? ""])); L.push([]); };
  if (rep.audience === "staff") sec("Tasks", rep.tasks);
  sec("Tickets", rep.tickets);
  if (rep.updates?.expected) sec("Daily updates", rep.updates);
  sec("Collaboration", rep.collab);
  if (rep.projects.length) { L.push(["Projects", "Open", "Done", "Overdue"]); rep.projects.forEach((p) => L.push([p.name, p.open, p.done, p.overdue])); L.push([]); }
  if (rep.teams) { L.push(["Team", "Open tasks", "Done tasks", "Overdue tasks", "On-time %", "Open tickets", "Closed tickets", "SLA %"]); rep.teams.forEach((t) => L.push([t.name, t.openTasks, t.doneTasks, t.overdueTasks, t.onTimeRate ?? "", t.openTickets, t.closedTickets, t.slaRate ?? ""])); L.push([]); }
  if (rep.members) { L.push(["Person", "Open tasks", "Done tasks", "Overdue tasks", "On-time %", "Open tickets", "Closed tickets", "SLA %", "Comments", "Daily updates"]); rep.members.forEach((m) => L.push([m.name, m.openTasks, m.doneTasks, m.overdueTasks, m.onTimeRate ?? "", m.openTickets, m.closedTickets, m.slaRate ?? "", m.comments, m.updates])); }
  return L.map((r) => r.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

export default function ReportsPage() {
  const [opts, setOpts] = useState(null);
  const [scope, setScope] = useState("me");
  const [days, setDays] = useState(29);
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get("/reports/options").then((r) => setOpts(r.data)).catch(() => setErr("Could not load reports.")); }, []);

  const range = useMemo(() => {
    if (days === "custom" && custom.from && custom.to) return custom;
    const n = days === "custom" ? 29 : days;
    return { from: iso(new Date(Date.now() - n * 864e5)), to: iso(new Date()) };
  }, [days, custom]);

  useEffect(() => {
    if (!opts) return;
    const [type, id] = scope.split(":");
    setBusy(true); setErr("");
    api.get("/reports", { params: { scope: type, id, ...range } })
      .then((r) => setRep(r.data))
      .catch((e) => { setRep(null); setErr(e.response?.data?.error || "Could not build the report."); })
      .finally(() => setBusy(false));
  }, [opts, scope, range]);

  const download = () => {
    const url = URL.createObjectURL(new Blob(["\ufeff" + toCsv(rep)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `report-${rep.label.replace(/\W+/g, "-").toLowerCase()}-${range.from}_${range.to}.csv` });
    a.click(); URL.revokeObjectURL(url);
  };

  if (!opts) return <Panel title="Reports" sub={err || "Loading…"} />;
  const staff = rep?.audience === "staff";
  const T = rep?.tasks, K = rep?.tickets;
  const pick = (id, label) => <option key={id} value={id}>{label}</option>;

  return (
    <div className="settings-stack rep">
      <Panel title="Reports" sub="Private to you: you only see your own report, and for staff your own teams. Admins can see everyone."
        action={rep && <span className="rep-actions"><button className="btn" onClick={download}><Download size={14} /> CSV</button><button className="btn" onClick={() => window.print()}><Printer size={14} /> Print / PDF</button></span>}>
        <div className="rep-filters">
          {opts.scopes.length > 1 || opts.users.length ? (
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              {opts.scopes.map((s) => pick(s.id ? `${s.type}:${s.id}` : s.type, s.label))}
              {opts.users.length > 0 && <optgroup label="People">{opts.users.map((u) => pick(`user:${u.id}`, u.name || u.email))}</optgroup>}
            </select>
          ) : <b>{opts.scopes[0].label}</b>}
          <select value={days} onChange={(e) => setDays(e.target.value === "custom" ? "custom" : Number(e.target.value))}>
            {PRESETS.map(([l, n]) => pick(n, `Last ${l}`))}{pick("custom", "Custom range")}
          </select>
          {days === "custom" && <><input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /><input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></>}
        </div>
        {err && <small className="rep-err">{err}</small>}
      </Panel>

      {busy && !rep && <Panel title="Building report…" />}
      {rep && (
        <>
          <Panel title={rep.label} sub={`${rep.range.from.slice(0, 10)} to ${rep.range.to.slice(0, 10)} · generated ${new Date(rep.generatedAt).toLocaleString()}`}>
            <div className="metric-grid rep-kpis">
              {staff && <MetricCard label="Tasks completed" value={T.completedInPeriod} icon={CheckCircle2} tone="green" foot={`${v(T.completionRate, "%")} completion rate`} />}
              {staff && <MetricCard label="On-time delivery" value={v(T.onTimeRate, "%")} icon={Clock} tone="purple" foot={`${T.late} finished late`} />}
              {staff && <MetricCard label="Overdue tasks" value={T.overdue} icon={AlertTriangle} tone="red" foot={T.avgDaysOverdue ? `avg ${T.avgDaysOverdue} days late` : "none late"} />}
              {staff && <MetricCard label="Open tasks" value={T.assignedOpen} icon={ListTodo} tone="blue" foot={`${T.blocked} blocked`} />}
              <MetricCard label={staff ? "Tickets closed" : "Requests resolved"} value={K.closedInPeriod} icon={Ticket} tone="green" foot={`${K.raisedInPeriod} raised in period`} />
              <MetricCard label="Open tickets" value={K.open} icon={Ticket} tone="blue" foot={`${K.needInfo} need more info`} />
              <MetricCard label="Avg resolution" value={v(K.avgResolutionDays, " d")} icon={Clock} tone="purple" foot="created to closed" />
              <MetricCard label="Within due date" value={v(K.slaRate, "%")} icon={CheckCircle2} tone="green" foot={`${K.overdue} overdue now`} />
            </div>
          </Panel>

          <Panel title="Activity trend" sub="Items created vs completed each week (tasks + tickets)"><Trend rows={rep.trend} /></Panel>

          <div className="rep-cols">
            {staff && <Panel title="Open tasks" sub="Current workload"><h5>By status</h5><Bars data={T.byStatus} order={["BACKLOG", "TODO", "IN_PROGRESS", "BLOCKED", "REVIEW"]} /><h5>By priority</h5><Bars data={T.byPriority} order={["URGENT", "HIGH", "MEDIUM", "LOW"]} /><h5>Aging</h5><Bars data={{ "Over 7 days": T.aging.d7, "Over 14 days": T.aging.d14, "Over 30 days": T.aging.d30 }} />
              <small className="rep-note">Avg cycle time {v(T.avgCycleDays, " days")} · completion rate = completed ÷ (open + completed + created in period)</small></Panel>}
            <Panel title={staff ? "Tickets" : "Your requests"} sub="Current queue and resolution"><h5>By progress</h5><Bars data={K.byProgress} /><h5>By priority</h5><Bars data={K.byPriority} order={["URGENT", "HIGH", "MEDIUM", "LOW"]} /><h5>Avg days to resolve, by priority</h5><Bars data={Object.fromEntries(Object.entries(K.avgResolutionByPriority).filter(([, x]) => x !== null))} />
              <small className="rep-note">Aging: {K.aging.d7} over 7 days · {K.aging.d14} over 14 · {K.aging.d30} over 30</small></Panel>
          </div>

          {rep.projects.length > 0 && <Panel title="By project"><Table cols={[["name", "Project"], ["open", "Open"], ["done", "Done in period"], ["overdue", "Overdue"]]} rows={rep.projects} /></Panel>}

          {staff && (rep.updates?.expected > 0 && rep.updates.posted > 0) && <Panel title="Daily updates"><div className="rep-inline"><span><b>{rep.updates.posted}</b> posted of {rep.updates.expected} expected ({v(rep.updates.rate, "%")})</span><span><b>{rep.updates.withBlockers}</b> reported blockers</span></div></Panel>}
          {staff && <Panel title="Collaboration"><div className="rep-inline"><span><b>{rep.collab.comments}</b> comments</span><span><b>{rep.collab.chatMessages}</b> chat messages</span></div></Panel>}

          {rep.teams && <Panel title="Team comparison" sub="Admin only"><Table cols={[["name", "Team"], ["openTasks", "Open tasks"], ["doneTasks", "Done"], ["overdueTasks", "Overdue"], ["onTimeRate", "On-time", (x) => v(x, "%")], ["openTickets", "Open tickets"], ["closedTickets", "Closed"], ["slaRate", "Within due", (x) => v(x, "%")]]} rows={rep.teams} /></Panel>}
          {rep.members && <Panel title="People" sub="Admin only · tasks and tickets assigned to each person"><Table cols={[["name", "Person"], ["openTasks", "Open tasks"], ["doneTasks", "Done"], ["overdueTasks", "Overdue"], ["onTimeRate", "On-time", (x) => v(x, "%")], ["openTickets", "Open tickets"], ["closedTickets", "Closed"], ["comments", "Comments"], ["updates", "Updates"]]} rows={rep.members} /></Panel>}
          {!T?.total && !K.total && <EmptyState title="No activity in this period" text="Try a longer date range." />}
        </>
      )}
    </div>
  );
}
