import { useEffect, useMemo, useState } from "react";
import { Inbox, CheckCircle2, Percent, Timer, AlertTriangle, FolderOpen, SearchCheck, LifeBuoy, UserX, Repeat, Hourglass, Trophy, Zap, Users, Download, ChevronUp, ChevronDown, Search } from "lucide-react";
import { api } from "../api";
import { on } from "../lib/realtime";
import { can } from "../lib/rbac";
import { fmtDate, fmtDateTime } from "../lib/dates";
import { downloadCsv } from "../lib/csv";
import { STATUS_LABEL, PROGRESS_LABEL, dayLabel } from "../lib/ticketStatus";
import Kpi from "../components/ui/Kpi";
import Panel from "../components/ui/Panel";
import Loading from "../components/ui/Loading";
import EmptyState from "../components/ui/EmptyState";
import NoAccess from "../components/ui/NoAccess";
import RangePicker, { presetRange } from "../components/ui/RangePicker";
import { TicketStatusBadge, PriorityBadge } from "../components/ui/StatusBadge";
import "../styles/reports.css";

const TABS = [["overview", "Overview"], ["teams", "Team comparison"], ["people", "People"], ["clients", "Clients"], ["tickets", "Ticket details"]];
const PAGE = 25;
const n = (v) => (v == null ? "—" : v);
const d1 = (v) => (v == null ? "—" : `${v}d`);
const pc = (v) => (v == null ? "—" : `${v}%`);
const monthLabel = (m) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;

// ---------- tiny helpers -----------------------------------------------------------------
function useSort(initial, dir = "desc") {
  const [s, setS] = useState({ key: initial, dir });
  const toggle = (key) => setS((o) => (o.key === key ? { key, dir: o.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const apply = (rows) => {
    const sign = s.dir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = a[s.key], y = b[s.key];
      if (x == null && y == null) return 0;
      if (x == null) return 1; // empty values always last
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sign;
    });
  };
  return { sort: s, toggle, apply };
}
function Th({ k, label, sort, toggle, num = true, title }) {
  const on_ = sort.key === k;
  return (
    <th className={num ? "num" : ""} title={title} aria-sort={on_ ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
      <button type="button" className={"th-sort" + (on_ ? " on" : "")} onClick={() => toggle(k)}>
        {label}{on_ && (sort.dir === "desc" ? <ChevronDown size={13} /> : <ChevronUp size={13} />)}
      </button>
    </th>
  );
}
function HBars({ items, max, tone = "violet" }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="hbars">
      {items.map((i) => (
        <div className="hbar" key={i.label} title={`${i.label}: ${i.value}`}>
          <span className="hbar-label">{i.label}</span>
          <span className="hbar-track"><i className={`hbar-fill ${i.tone || tone}`} style={{ width: `${(i.value / top) * 100}%` }} /></span>
          <b className="hbar-val">{i.value}</b>
        </div>
      ))}
    </div>
  );
}
const Rank = ({ rows, valueKey, empty = "No data in this period" }) => {
  const list = rows.filter((r) => r[valueKey] > 0).sort((a, b) => b[valueKey] - a[valueKey]).slice(0, 5);
  if (!list.length) return <small className="hint">{empty}</small>;
  const top = list[0][valueKey];
  return (
    <ol className="rank">
      {list.map((r, i) => (
        <li key={r.id}><em>{i + 1}</em><span className="rank-name">{r.name}</span><span className="rank-bar"><i style={{ width: `${(r[valueKey] / top) * 100}%` }} /></span><b>{r[valueKey]}</b></li>
      ))}
    </ol>
  );
};
// The standout value of a column; null when there is nothing to compare (all equal / fewer than two values).
const best = (rows, key, mode = "max") => {
  const vals = rows.map((r) => r[key]).filter((v) => v != null);
  if (vals.length < 2) return null;
  const hi = Math.max(...vals), lo = Math.min(...vals);
  return hi === lo ? null : mode === "max" ? hi : lo;
};

// ---------- page ---------------------------------------------------------------------------
export default function ReportsPage({ me, notify, onOpenTicket }) {
  const [range, setRange] = useState(() => presetRange("3m"));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("overview");
  const [tick, setTick] = useState(0);
  const [tf, setTf] = useState({ q: "", team: "", status: "", priority: "", client: "", scope: "period" });
  const [page, setPage] = useState(0);
  const [who, setWho] = useState("STAFF");

  useEffect(() => on("app.refresh", () => setTick((x) => x + 1)), []);
  useEffect(() => {
    if (!can(me, "admin.view")) return undefined;
    let live = true;
    api.get("/admin/reports", { params: range })
      .then((r) => { if (live) { setData(r.data); setErr(""); } })
      .catch((e) => { if (live) { const m = e.response?.data?.error || "Could not load reports"; setErr(m); notify?.(m, "error"); } });
    return () => { live = false; };
  }, [range.from, range.to, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPage(0), [tf, range.from, range.to]);

  const teamSort = useSort("opened"), peopleSort = useSort("closed"), clientSort = useSort("opened"), ticketSort = useSort("createdAt");

  const teams = data?.teams || [];
  const filteredTickets = useMemo(() => {
    if (!data) return [];
    const q = tf.q.trim().toLowerCase();
    return data.tickets.filter((t) => {
      if (tf.scope === "period" && !(t.createdInRange || t.closedInRange)) return false;
      if (tf.scope === "open" && t.status === "CLOSED") return false;
      if (tf.scope === "overdue" && !t.overdue) return false;
      if (tf.team && t.teamId !== tf.team && !t.otherTeams.includes(teams.find((x) => x.id === tf.team)?.name)) return false;
      if (tf.status && t.status !== tf.status) return false;
      if (tf.priority && t.priority !== tf.priority) return false;
      if (tf.client && t.clientId !== tf.client) return false;
      if (q && ![t.key, t.title, t.client, t.project, t.raisedBy, t.assignee, t.team, t.closedBy].some((v) => (v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, tf, teams]);

  if (!can(me, "admin.view")) return <NoAccess what="reports" />;

  const header = (
    <div className="page-tools">
      <div className="seg" role="tablist" aria-label="Report sections">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="row">
        <RangePicker from={range.from} to={range.to} onChange={setRange} />
      </div>
    </div>
  );
  if (err && !data) return <>{header}<EmptyState icon={<AlertTriangle />} title="Could not load reports" text={err} /></>;
  if (!data) return <>{header}<Loading text="Building reports…" /></>;

  const t = data.totals;
  const openTotal = t.currentlyOpen + t.reviewTest + t.reviewHelp;
  const periodNote = <small className="hint">Period {fmtDate(data.range.from)} to {fmtDate(data.range.to)} · generated {fmtDateTime(data.generatedAt)}{data.truncated ? " · showing the latest 5000 tickets only" : ""}</small>;
  const maxMonth = Math.max(1, ...data.months.flatMap((m) => [m.opened, m.closed]));
  const staff = data.people.filter((p) => p.kind === "STAFF");

  // ---- Overview ----------------------------------------------------------------------
  const topTeam = (key, mode = "max") => {
    const vals = teams.map((x) => x[key]).filter((v) => v != null && (mode === "min" || v > 0));
    if (!vals.length) return null;
    const b = mode === "max" ? Math.max(...vals) : Math.min(...vals);
    return teams.filter((x) => x[key] === b).map((x) => x.name).join(", ");
  };
  const topPerson = (key) => { const l = staff.filter((p) => p[key] > 0).sort((a, b) => b[key] - a[key]); return l[0] ? `${l[0].name} (${l[0][key]})` : null; };
  const overview = (
    <>
      <div className="kpi-grid">
        <Kpi icon={Inbox} tone="violet" label="Tickets opened" value={t.opened} hint="created in this period" />
        <Kpi icon={CheckCircle2} tone="green" label="Tickets closed" value={t.closed} hint="closed in this period" />
        <Kpi icon={Percent} tone="green" label="Close rate" value={pc(t.closeRate)} hint="closed ÷ opened" />
        <Kpi icon={Timer} tone="blue" label="Avg. days to close" value={d1(t.avgDaysToClose)} hint="creation → closure" />
        <Kpi icon={FolderOpen} tone="blue" label="Open now" value={t.currentlyOpen} hint="status Open" onClick={() => { setTf({ ...tf, scope: "open", status: "OPEN" }); setTab("tickets"); }} />
        <Kpi icon={SearchCheck} tone="violet" label="Review / Test" value={t.reviewTest} hint="waiting for review" onClick={() => { setTf({ ...tf, scope: "open", status: "REVIEW_TEST" }); setTab("tickets"); }} />
        <Kpi icon={LifeBuoy} tone="amber" label="Review / Help" value={t.reviewHelp} hint="need more info" onClick={() => { setTf({ ...tf, scope: "open", status: "REVIEW_HELP" }); setTab("tickets"); }} />
        <Kpi icon={AlertTriangle} tone="rose" label="Overdue" value={t.overdue} hint="open and past due" onClick={() => { setTf({ ...tf, scope: "overdue", status: "" }); setTab("tickets"); }} />
        <Kpi icon={Hourglass} tone="amber" label="Avg. age of open" value={d1(t.avgOpenAgeDays)} hint="how long open tickets wait" />
        <Kpi icon={UserX} tone="rose" label="Unassigned" value={t.unassigned} hint="open, no assignee" />
        <Kpi icon={Repeat} tone="violet" label="Team-to-team" value={t.teamToTeam} hint="raised for another team" />
      </div>

      <div className="grid-2">
        <div className="chart-card">
          <div className="chart-head"><b>Opened vs closed per month</b><span className="legend"><i className="dot open" /> Opened <i className="dot done" /> Closed</span></div>
          <div className="bars" role="img" aria-label="Tickets opened and closed per month">
            {data.months.map((m) => (
              <div className="bar-col" key={m.month}>
                <div className="bar-pair">
                  <div className="bar open" title={`${m.opened} opened`} style={{ height: `${(m.opened / maxMonth) * 100}%`, minHeight: m.opened ? 3 : 0 }} />
                  <div className="bar done" title={`${m.closed} closed`} style={{ height: `${(m.closed / maxMonth) * 100}%`, minHeight: m.closed ? 3 : 0 }} />
                </div>
                <small>{monthLabel(m.month)}</small><small className="nums">{m.opened} / {m.closed}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-head"><b>Right now</b><small className="hint">{openTotal} open · {data.byStatus.CLOSED} closed</small></div>
          <HBars items={[
            { label: STATUS_LABEL.OPEN, value: data.byStatus.OPEN, tone: "blue" }, { label: STATUS_LABEL.REVIEW_TEST, value: data.byStatus.REVIEW_TEST, tone: "violet" },
            { label: STATUS_LABEL.REVIEW_HELP, value: data.byStatus.REVIEW_HELP, tone: "amber" }, { label: STATUS_LABEL.CLOSED, value: data.byStatus.CLOSED, tone: "green" },
          ]} />
          <div className="chart-head" style={{ marginTop: 14 }}><b>Open tickets by priority</b></div>
          <HBars items={["URGENT", "HIGH", "MEDIUM", "LOW"].map((p) => ({ label: p[0] + p.slice(1).toLowerCase(), value: data.byPriority.open[p], tone: { URGENT: "rose", HIGH: "amber", MEDIUM: "blue", LOW: "grey" }[p] }))} />
        </div>
      </div>

      <Panel title="Highlights" sub="Who stands out in this period">
        <div className="kpi-grid">
          <Kpi className="kpi-text" icon={Trophy} tone="violet" label="Team that opened most" value={topTeam("opened") || "—"} hint="tickets owned by the team" />
          <Kpi className="kpi-text" icon={Trophy} tone="green" label="Team that closed most" value={topTeam("closed") || "—"} hint="tickets closed in the period" />
          <Kpi className="kpi-text" icon={Zap} tone="blue" label="Fastest team" value={topTeam("avgDaysToClose", "min") || "—"} hint="lowest average days to close" />
          <Kpi className="kpi-text" icon={AlertTriangle} tone="rose" label="Most overdue" value={topTeam("overdue") || "—"} hint="open tickets past due" />
          <Kpi className="kpi-text" icon={Users} tone="violet" label="Staff who opened most" value={topPerson("opened") || "—"} hint="tickets raised" />
          <Kpi className="kpi-text" icon={Users} tone="green" label="Staff who closed most" value={topPerson("closed") || "—"} hint="tickets closed" />
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="Teams: tickets opened" sub="Tickets owned by each team, created in the period"><Rank rows={teams} valueKey="opened" /></Panel>
        <Panel title="Teams: tickets closed" sub="Closed in the period"><Rank rows={teams} valueKey="closed" /></Panel>
        <Panel title="People: tickets raised" sub="Staff and clients, created in the period"><Rank rows={data.people} valueKey="opened" /></Panel>
        <Panel title="People: tickets closed" sub="Who moved tickets to Closed"><Rank rows={data.people} valueKey="closed" /></Panel>
      </div>
    </>
  );

  // ---- Teams ---------------------------------------------------------------------------
  const TEAM_COLS = [
    ["opened", "Opened", "Tickets owned by the team, created in the period"], ["closed", "Closed", "Closed in the period"], ["closeRate", "Close rate", "Closed ÷ opened"],
    ["open", "Open", "Currently Open"], ["reviewTest", "Review/Test", "Waiting for review"], ["reviewHelp", "Review/Help", "Need more info"],
    ["overdue", "Overdue", "Open and past due"], ["unassigned", "Unassigned", "Open with no assignee"], ["urgentOpen", "High/Urgent", "Open High or Urgent tickets"],
    ["avgDaysToClose", "Avg days to close", "Creation → closure"], ["avgOpenAgeDays", "Avg open age", "Days open tickets have waited"], ["oldestOpenDays", "Oldest open", "Days"],
    ["raisedByMembers", "Raised by team", "Tickets raised by the team's people"], ["raisedForOtherTeams", "For other teams", "Raised by this team for another team"], ["receivedFromOtherTeams", "From other teams", "Raised for this team by other teams"],
    ["receivedFromClients", "From clients", "Raised for this team by clients"], ["closedByMembers", "Closed by team", "Closures done by the team's people"], ["participating", "Shared with", "Open tickets where the team participates"],
    ["tasksCreated", "Tasks new", ""], ["tasksDone", "Tasks done", ""], ["tasksOpen", "Tasks open", ""], ["tasksOverdue", "Tasks overdue", ""],
  ];
  const LOWER_IS_BETTER = new Set(["avgDaysToClose", "avgOpenAgeDays", "overdue", "unassigned", "oldestOpenDays", "tasksOverdue"]);
  const teamRows = teamSort.apply(teams);
  const maxTeam = Math.max(1, ...teams.flatMap((x) => [x.opened, x.closed]));
  const teamsTab = (
    <>
      <div className="chart-card">
        <div className="chart-head"><b>Opened vs closed by team</b><span className="legend"><i className="dot open" /> Opened <i className="dot done" /> Closed</span></div>
        {teams.length === 0 ? <small className="hint">No teams yet</small> : (
          <div className="team-bars">
            {[...teams].sort((a, b) => b.opened + b.closed - (a.opened + a.closed)).map((x) => (
              <div className="team-bar" key={x.id}>
                <span className="team-bar-name">{x.name}</span>
                <span className="team-bar-tracks">
                  <span className="hbar-track"><i className="hbar-fill violet" style={{ width: `${(x.opened / maxTeam) * 100}%` }} /></span>
                  <span className="hbar-track"><i className="hbar-fill green" style={{ width: `${(x.closed / maxTeam) * 100}%` }} /></span>
                </span>
                <b className="nums">{x.opened} / {x.closed}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <Panel title="Team comparison" sub="Click a column to sort · the best value in each column is highlighted · click a team to see its tickets"
        action={<button type="button" className="btn-soft sm" onClick={() => downloadCsv("tendrils-team-comparison", [{ label: "Team", get: (r) => r.name }, { label: "Members", get: (r) => r.members }, ...TEAM_COLS.map(([k, l]) => ({ label: l, get: (r) => r[k] }))], teamRows)}><Download size={14} /> CSV</button>}>
        {teams.length === 0 ? <EmptyState icon={<Users />} title="No teams yet" text="Create teams from the Teams page." /> : (
          <div className="table-wrap report-scroll">
            <table className="data-table report-table">
              <thead><tr>
                <Th k="name" label="Team" num={false} {...teamSort} /><Th k="members" label="Members" {...teamSort} />
                {TEAM_COLS.map(([k, l, tip]) => <Th key={k} k={k} label={l} title={tip} {...teamSort} />)}
              </tr></thead>
              <tbody>
                {teamRows.map((x) => (
                  <tr key={x.id} className="clickable" onClick={() => { setTf({ q: "", team: x.id, status: "", priority: "", client: "", scope: "period" }); setTab("tickets"); }}>
                    <td data-label="Team"><b>{x.name}</b></td><td data-label="Members" className="num">{x.members}</td>
                    {TEAM_COLS.map(([k, l]) => {
                      const b = best(teams, k, LOWER_IS_BETTER.has(k) ? "min" : "max");
                      const isBest = b != null && x[k] === b;
                      return <td key={k} data-label={l} className={"num" + (isBest ? " best" : "") + (k === "overdue" && x[k] ? " overdue" : "")}>{k === "closeRate" ? pc(x[k]) : k.startsWith("avg") ? d1(x[k]) : k === "oldestOpenDays" ? d1(x[k]) : n(x[k])}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <small className="hint">Opened/closed count tickets a team <b>owns</b>. "Raised by team" counts tickets the team's people created (for any team). "Closed by team" counts closures done by the team's people.</small>
      </Panel>
    </>
  );

  // ---- People ---------------------------------------------------------------------------
  const peopleList = peopleSort.apply(who === "ALL" ? data.people : data.people.filter((p) => p.kind === who));
  const peopleTab = (
    <>
      <div className="page-tools">
        <div className="seg" role="group" aria-label="Who">
          {[["STAFF", "Staff"], ["CLIENT", "Clients"], ["ALL", "Everyone"]].map(([k, l]) => <button key={k} type="button" className={who === k ? "on" : ""} onClick={() => setWho(k)}>{l}</button>)}
        </div>
        <button type="button" className="btn-soft" onClick={() => downloadCsv("tendrils-people-report", [{ label: "Person", get: (r) => r.name }, { label: "Email", get: (r) => r.email }, { label: "Type", get: (r) => r.kind }, { label: "Teams", get: (r) => r.teams.join("; ") }, { label: "Tickets opened", get: (r) => r.opened }, { label: "Tickets closed", get: (r) => r.closed }, { label: "Assigned open", get: (r) => r.assignedOpen }, { label: "Assigned closed (period)", get: (r) => r.assignedClosed }, { label: "Overdue", get: (r) => r.overdue }, { label: "Tasks done", get: (r) => r.tasksDone }, { label: "Tasks open", get: (r) => r.tasksOpen }], peopleList)}><Download size={15} /> CSV</button>
      </div>
      <Panel title="Who opens and who closes" sub="Opened = tickets they raised · Closed = tickets they moved to Closed (clients close by approving)">
        {peopleList.length === 0 ? <EmptyState icon={<Users />} title="No activity" text="Nobody in this group opened or closed tickets in this period." /> : (
          <div className="table-wrap report-scroll">
            <table className="data-table report-table">
              <thead><tr>
                <Th k="name" label="Person" num={false} {...peopleSort} /><th>Teams</th>
                <Th k="opened" label="Opened" {...peopleSort} /><Th k="closed" label="Closed" {...peopleSort} />
                <Th k="assignedOpen" label="Assigned (open)" {...peopleSort} /><Th k="assignedClosed" label="Assigned (closed)" {...peopleSort} />
                <Th k="overdue" label="Overdue" {...peopleSort} /><Th k="tasksDone" label="Tasks done" {...peopleSort} /><Th k="tasksOpen" label="Tasks open" {...peopleSort} />
              </tr></thead>
              <tbody>
                {peopleList.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Person"><b>{p.name}</b><div>{p.email}</div></td>
                    <td data-label="Teams">{p.teams.length ? p.teams.join(", ") : p.kind === "CLIENT" ? "Client" : "—"}</td>
                    <td data-label="Opened" className="num">{p.opened}</td><td data-label="Closed" className="num">{p.closed}</td>
                    <td data-label="Assigned (open)" className="num">{p.assignedOpen}</td><td data-label="Assigned (closed)" className="num">{p.assignedClosed}</td>
                    <td data-label="Overdue" className={"num" + (p.overdue ? " overdue" : "")}>{p.overdue}</td>
                    <td data-label="Tasks done" className="num">{p.tasksDone}</td><td data-label="Tasks open" className="num">{p.tasksOpen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );

  // ---- Clients ---------------------------------------------------------------------------
  const clientRows = clientSort.apply(data.clients);
  const clientsTab = (
    <Panel title="Tickets by client" sub="Click a client to see its tickets"
      action={<button type="button" className="btn-soft sm" onClick={() => downloadCsv("tendrils-client-report", [{ label: "Client", get: (r) => r.name }, { label: "Opened", get: (r) => r.opened }, { label: "Closed", get: (r) => r.closed }, { label: "Open now", get: (r) => r.open }, { label: "Overdue", get: (r) => r.overdue }], clientRows)}><Download size={14} /> CSV</button>}>
      {clientRows.length === 0 ? <EmptyState icon={<Inbox />} title="No tickets" text="No client tickets in this period." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><Th k="name" label="Client" num={false} {...clientSort} /><Th k="opened" label="Opened" {...clientSort} /><Th k="closed" label="Closed" {...clientSort} /><Th k="open" label="Open now" {...clientSort} /><Th k="overdue" label="Overdue" {...clientSort} /></tr></thead>
            <tbody>
              {clientRows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => { setTf({ q: "", team: "", status: "", priority: "", client: c.id, scope: "period" }); setTab("tickets"); }}>
                  <td data-label="Client"><b>{c.name}</b></td><td data-label="Opened" className="num">{c.opened}</td><td data-label="Closed" className="num">{c.closed}</td>
                  <td data-label="Open now" className="num">{c.open}</td><td data-label="Overdue" className={"num" + (c.overdue ? " overdue" : "")}>{c.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );

  // ---- Tickets ---------------------------------------------------------------------------
  const sorted = ticketSort.apply(filteredTickets);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const shown = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const clientOpts = data.clients;
  const TICKET_CSV = [
    ["Ticket", (r) => r.key], ["Title", (r) => r.title], ["Client", (r) => r.client], ["Project", (r) => r.project || ""],
    ["Status", (r) => STATUS_LABEL[r.status] || r.status], ["Progress", (r) => PROGRESS_LABEL[r.progress] || ""], ["Priority", (r) => r.priority],
    ["Owner team", (r) => r.team || ""], ["Other teams", (r) => r.otherTeams.join("; ")], ["Raised from team", (r) => r.fromTeams.join("; ")],
    ["Raised by", (r) => r.raisedBy || ""], ["Raised by type", (r) => r.raisedByKind || ""], ["Assignee", (r) => r.assignee || ""], ["Collaborators", (r) => r.collaborators],
    ["Created", (r) => fmtDate(r.createdAt)], ["Due", (r) => fmtDate(r.dueDate, "")], ["Closed", (r) => fmtDate(r.closedAt, "")], ["Closed by", (r) => r.closedBy || ""],
    ["Days open / to close", (r) => r.ageDays], ["Overdue", (r) => (r.overdue ? "Yes" : "No")], ["Tasks done", (r) => r.tasksDone], ["Tasks total", (r) => r.tasksTotal], ["Comments", (r) => r.comments], ["Files", (r) => r.files],
  ];
  const set = (patch) => setTf((o) => ({ ...o, ...patch }));
  const ticketsTab = (
    <Panel title="Ticket details" sub={`${sorted.length} ticket${sorted.length === 1 ? "" : "s"} match`}
      action={<button type="button" className="btn-soft sm" disabled={!sorted.length} onClick={() => downloadCsv("tendrils-ticket-report", TICKET_CSV.map(([label, get]) => ({ label, get })), sorted)}><Download size={14} /> CSV (all {sorted.length})</button>}>
      <div className="report-filters">
        <label className="search-box"><Search size={15} /><input type="search" placeholder="Search ticket, client, person…" value={tf.q} onChange={(e) => set({ q: e.target.value })} /></label>
        <select value={tf.scope} onChange={(e) => set({ scope: e.target.value })} aria-label="Which tickets">
          <option value="period">Opened or closed in period</option><option value="open">All open now</option><option value="overdue">Overdue now</option><option value="all">Everything loaded</option>
        </select>
        <select value={tf.team} onChange={(e) => set({ team: e.target.value })} aria-label="Team"><option value="">All teams</option>{teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select value={tf.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status"><option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={tf.priority} onChange={(e) => set({ priority: e.target.value })} aria-label="Priority"><option value="">Any priority</option>{["URGENT", "HIGH", "MEDIUM", "LOW"].map((p) => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}</select>
        <select value={tf.client} onChange={(e) => set({ client: e.target.value })} aria-label="Client"><option value="">All clients</option>{clientOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {(tf.q || tf.team || tf.status || tf.priority || tf.client || tf.scope !== "period") && <button type="button" className="btn-soft sm" onClick={() => setTf({ q: "", team: "", status: "", priority: "", client: "", scope: "period" })}>Reset</button>}
      </div>
      {shown.length === 0 ? <EmptyState icon={<Inbox />} title="No tickets match" text="Try a wider date range or reset the filters." /> : (
        <>
          <div className="table-wrap report-scroll">
            <table className="data-table report-table tickets-report">
              <thead><tr>
                <Th k="key" label="Ticket" num={false} {...ticketSort} /><Th k="client" label="Client / project" num={false} {...ticketSort} /><Th k="status" label="Status" num={false} {...ticketSort} /><Th k="priority" label="Priority" num={false} {...ticketSort} />
                <Th k="team" label="Team" num={false} {...ticketSort} /><Th k="raisedBy" label="Raised by" num={false} {...ticketSort} /><Th k="assignee" label="Assignee" num={false} {...ticketSort} />
                <Th k="createdAt" label="Created" num={false} {...ticketSort} /><Th k="dueDate" label="Due" num={false} {...ticketSort} /><Th k="closedAt" label="Closed" num={false} {...ticketSort} /><Th k="closedBy" label="Closed by" num={false} {...ticketSort} />
                <Th k="ageDays" label="Days" {...ticketSort} title="Days open, or days it took to close" /><Th k="tasksDone" label="Tasks" {...ticketSort} /><Th k="comments" label="Comments" {...ticketSort} />
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => onOpenTicket?.({ id: r.id, key: r.key })}>
                    <td data-label="Ticket"><b>{r.key}</b><div className="clip">{r.title}</div></td>
                    <td data-label="Client">{r.client}{r.project && <div>{r.project}</div>}</td>
                    <td data-label="Status"><TicketStatusBadge ticket={r} /></td>
                    <td data-label="Priority"><PriorityBadge value={r.priority} /></td>
                    <td data-label="Team">{r.team || "—"}{r.otherTeams.length > 0 && <div>+ {r.otherTeams.join(", ")}</div>}{r.fromTeams.length > 0 && r.fromTeams[0] !== r.team && <div>from {r.fromTeams.join(", ")}</div>}</td>
                    <td data-label="Raised by">{r.raisedBy || "—"}{r.raisedByKind === "CLIENT" && <div>Client</div>}</td>
                    <td data-label="Assignee">{r.assignee || <span className="muted">Unassigned</span>}</td>
                    <td data-label="Created">{fmtDate(r.createdAt)}</td>
                    <td data-label="Due" className={r.overdue ? "overdue" : ""}>{fmtDate(r.dueDate)}</td>
                    <td data-label="Closed">{fmtDate(r.closedAt)}</td>
                    <td data-label="Closed by">{r.closedBy || (r.closedAt ? "—" : "")}</td>
                    <td data-label="Days" className="num" title={r.closedAt ? "Days it took to close" : "Days open"}>{dayLabel(r.ageDays)}</td>
                    <td data-label="Tasks" className="num">{r.tasksTotal ? `${r.tasksDone}/${r.tasksTotal}` : "—"}</td>
                    <td data-label="Comments" className="num">{r.comments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="pager">
              <button type="button" className="btn-soft sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <small>Page {page + 1} of {pages}</small>
              <button type="button" className="btn-soft sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </Panel>
  );

  return (
    <div className="stack reports">
      {header}
      {periodNote}
      {tab === "overview" && overview}
      {tab === "teams" && teamsTab}
      {tab === "people" && peopleTab}
      {tab === "clients" && clientsTab}
      {tab === "tickets" && ticketsTab}
    </div>
  );
}
