import React, { useCallback, useEffect, useState } from "react";
import {
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Layers,
  Users2,
  Zap,
  CheckCircle2,
  LoaderCircle,
  Mail,
  ShieldCheck,
  X,
} from "lucide-react";

import { api } from "./api";
import { can } from "./lib/rbac";
import NoAccess from "./components/ui/NoAccess";
import * as realtime from "./lib/realtime";
import DevLogin from "./components/dev/DevLogin";
import { useWorkspace } from "./hooks/useWorkspace";
import { normalizePayload } from "./lib/dates";

import Brand from "./components/ui/Brand";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import PageHeader from "./components/layout/PageHeader";
import EntityModal from "./components/forms/EntityModal";
import TicketDrawer from "./components/tickets/TicketDrawer";

import OverviewPage from "./pages/OverviewPage";
import TicketsPage from "./pages/TicketsPage";
import TasksPage from "./pages/TasksPage";
import ProjectsPage from "./pages/ProjectsPage";
import ClientsPage from "./pages/ClientsPage";
import TeamsPage from "./pages/TeamsPage";
import ActivityPage from "./pages/ActivityPage";
import NotificationsPage from "./pages/NotificationsPage";
import SettingsPage from "./pages/SettingsPage";
import ChatPage from "./pages/ChatPage";
// import UpdatesPage from "./pages/UpdatesPage";
import NotesPage from "./pages/NotesPage";
import AdminPage from "./pages/AdminPage";
import DocumentsPage from "./pages/DocumentsPage";

const pageMeta = {
  "/": [
    "Overview",
    "A clear view of client delivery, team ownership and what needs attention.",
  ],
  "/clients": [
    "Clients",
    "A separate, organized workspace for every client.",
  ],
  "/documents": ["Documents", "Important files, spreadsheets, policies and shared resources."],
  "/projects": [
    "Projects",
    "Track delivery, milestones and progress across client work.",
  ],
  "/tickets": [
    "Tickets",
    "Every request has an owner, a priority and a next step.",
  ],
  "/tasks": [
    "Tasks",
    "Your team’s work, deadlines and what needs attention.",
  ],
  "/chat": ["Chat", "Talk with your team, in General or per project."],
  "/notes": ["My notes", "Private notes that only you can see. Never emailed or shared."],
  // "/updates": ["Daily update", "Share what you did and what is next. Admins are notified."],
  "/admin": ["Admin console", "Daily updates, workload and activity across the team."],
  "/teams": [
    "Teams",
    "The people and disciplines behind the work.",
  ],
  "/activity": [
    "Activity log",
    "A traceable timeline of changes across the workspace.",
  ],
  "/notifications": [
    "Notifications",
    "Assignments, updates and reminders that need your attention.",
  ],
  "/settings": [
    "Settings",
    "Workspace configuration and security information.",
  ],
};

export default function App() {
  const { data, loading, error, refresh, setData } = useWorkspace();

  const [modal, setModal] = useState("");
  const [selected, setSelected] = useState(null);
  const [comments, setComments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const loc = useLocation();
  const navigate = useNavigate();
  const authError = new URLSearchParams(loc.search).get("authError");

  const me = data.me;
  const path = loc.pathname;

  // Layout state: desktop sidebar can collapse (remembered); on phones it is a slide-in drawer.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("tendrils.sidebar") === "collapsed");
  const [navOpen, setNavOpen] = useState(false);
  const toggleCollapsed = () => setCollapsed((c) => { localStorage.setItem("tendrils.sidebar", c ? "open" : "collapsed"); return !c; });
  useEffect(() => { setNavOpen(false); window.scrollTo(0, 0); }, [path]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { setNavOpen(false); setSelected(null); setModal(""); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [title, subtitle] = pageMeta[path] || pageMeta["/"];
  const internal = !!me?.isInternal;

  const unread = (data.notifications || []).filter(
    (notification) => !notification.readAt
  ).length;

  const selectedId = selected?.id;

  const loadComments = useCallback(() => {
    if (!selectedId) return Promise.resolve();
    return api
      .get(`/tickets/${selectedId}/comments`)
      .then((response) => setComments(response.data))
      .catch(() => setComments([]));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setComments([]);
      return;
    }
    loadComments();
  }, [selectedId, loadComments]);

  const notify = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Realtime: one WebSocket per signed-in session (notifications + chat).
  const meId = me?.user?.id;
  useEffect(() => {
    if (!meId) { realtime.disconnect(); return undefined; }
    realtime.connect();
    return realtime.on("notification", ({ notification }) => {
      setData((d) => ({ ...d, notifications: [notification, ...(d.notifications || [])] }));
      notify(notification.title);
    });
  }, [meId, notify, setData]);

  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    if (!internal) return undefined;
    let t;
    const load = () => {
      clearTimeout(t);
      t = setTimeout(() => api.get("/chat/unread").then((r) => setChatUnread(r.data.total)).catch(() => {}), 250);
    };
    load();
    const offs = ["chat.message", "chat.read", "chat.unread.refresh", "open"].map((ev) => realtime.on(ev, load));
    return () => { clearTimeout(t); offs.forEach((off) => off()); };
  }, [internal]);

  const create = async (kind, payload) => {
    setSaving(true);

    try {
      const normalizedPayload = normalizePayload(payload);

      if (kind === "client") {
        await api.post("/organizations", normalizedPayload);
      } else if (kind === "comment") {
        await api.post(
          `/tickets/${selected.id}/comments`,
          normalizedPayload
        );
      } else {
        const endpoint =
          kind === "project"
            ? "/projects"
            : kind === "task"
              ? "/tasks"
              : "/tickets";

        await api.post(endpoint, normalizedPayload);
      }

      notify("Saved successfully");
      setModal("");
      if (kind === "comment") await loadComments();
      await refresh();
    } catch (err) {
      notify(
        err.response?.data?.error ||
          "Could not save. Check permissions and required fields.",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const update = async (type, id, body) => {
    try {
      const res = await api.patch(`/${type}/${id}`, body);
      notify(res.data?.autoUnassigned ? "Team updated — the previous assignee isn't in this team, so pick a new assignee." : "Updated");
      await refresh();

      if (type === "tickets" && selected) {
        setSelected((current) =>
          current ? { ...current, ...body } : current
        );
      }
      return true;
    } catch (err) {
      notify(err.response?.data?.error || "Update failed", "error");
      return false;
    }
  };

  const upload = async (event, ticketId) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("ticketId", ticketId);

    try {
      await api.post("/files", formData);
      notify("File uploaded");
      await refresh();
    } catch (err) {
      notify(err.response?.data?.error || "Upload failed", "error");
    } finally {
      event.target.value = "";
    }
  };

  const newAction = () => {
    const target = { "/": "ticket", "/tickets": "ticket", "/tasks": "task", "/projects": "project", "/clients": "client" }[path];
    if (target) setModal(target);
  };

  // Which primary button does this page offer for the current role?
  const action = {
    "/": can(me, "ticket.create") && "New ticket",
    "/tickets": can(me, "ticket.create") && "New ticket",
    "/tasks": can(me, "task.create") && "New task",
    "/projects": can(me, "project.create") && "New project",
    "/clients": can(me, "org.create") && "New client",
  }[path] || null;

  // Always show the freshest copy of the open ticket (assignee, linked task, status).
  const openTicket = selected ? (data.tickets || []).find((t) => t.id === selected.id) || selected : null;

  if (loading) {
    return (
      <div className="loader" role="status">
        <div className="logo">t</div>
        <LoaderCircle className="spin" />
        <span>Preparing your workspace…</span>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="signin">
        <section className="sign-hero">
          <Brand />
          <div>
            <h1>One calm place for client delivery.</h1>
            <p>Tickets, tasks, teams and chat — organised per client, with the right access for everyone.</p>
          </div>
          <div className="sign-points">
            <div><Layers size={18} /> Tickets turn into tasks automatically</div>
            <div><Users2 size={18} /> Role-based access for staff and clients</div>
            <div><Zap size={18} /> Live chat and notifications</div>
          </div>
        </section>
        <section className="sign-right">
          <div className="sign-card">
            <h2>Sign in</h2>
            <p>Use the Google account your invitation was sent to.</p>
            {authError === "not_invited" && <div className="error" role="alert"><AlertCircle size={18} />This Google account hasn’t been invited yet. Ask a Tendrils administrator to invite this exact email address.</div>}
            {authError === "1" && <div className="error" role="alert"><AlertCircle size={18} />Sign-in failed. Please try again with a Google account whose email is verified.</div>}
            {error && <div className="error" role="alert"><AlertCircle size={18} />{error}</div>}
            <a className="google" href="/auth/signin">Continue with Google <ArrowRight size={17} /></a>
            <div className="domain"><Mail size={20} /><div><b>Sign in with the invited email</b><small>Staff and clients both use Google. Any email works if you were invited.</small></div></div>
            <DevLogin />
            <small className="security"><ShieldCheck size={15} /> Protected by OAuth and server-side access controls.</small>
            <button className="retry" onClick={refresh}>Retry connection</button>
            <small style={{ textAlign: "center" }}>Need access? Ask your Tendrils administrator for an invitation.</small>
          </div>
        </section>
      </div>
    );
  }

  const guard = (allowed, what, element) => (allowed ? element : <NoAccess what={what} />);

  return (
    <div className={"app" + (collapsed ? " collapsed" : "") + (navOpen ? " nav-open" : "")}>
      <Sidebar me={me} unread={unread} chatUnread={chatUnread} collapsed={collapsed} onToggleCollapse={toggleCollapsed} onNavigate={() => setNavOpen(false)} />
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <main>
        <Topbar title={title} me={me} hasUnread={unread > 0} onMenu={() => setNavOpen(true)} showSearch={path === "/tickets" || path === "/tasks"} />

        <section className={"page" + (path === "/chat" ? " page-chat" : "")}>
          <PageHeader
            title={path === "/" ? `Welcome back, ${me.user.name?.split(" ")[0] || "there"}.` : title}
            subtitle={subtitle}
            actionLabel={action}
            onAction={newAction}
            onRefresh={refresh}
          />

          <Routes>
            <Route path="/" element={<OverviewPage data={data} onSelectTicket={setSelected} />} />
            <Route path="/tickets" element={<TicketsPage data={data} onSelect={setSelected} />} />
            <Route path="/tasks" element={guard(internal, "tasks", <TasksPage data={data} onCreate={() => setModal("task")} onStatusChange={(task, status) => update("tasks", task.id, { status })} />)} />
            <Route path="/documents" element={<DocumentsPage me={me} notify={notify} />} />
            <Route path="/projects" element={<ProjectsPage data={data} onRefresh={refresh} notify={notify} />} />
            <Route path="/chat" element={guard(can(me, "chat.use"), "team chat", <ChatPage me={me} users={data.users || []} notify={notify} />)} />
            <Route path="/notes" element={guard(internal, "my notes", <NotesPage notify={notify} />)} />
            {/* <Route path="/updates" element={guard(can(me, "update.post"), "daily updates", <UpdatesPage notify={notify} onRefresh={refresh} />)} /> */}
            <Route path="/admin" element={guard(can(me, "admin.view"), "the admin console", <AdminPage me={me} notify={notify} orgs={data.organizations || []} teams={data.teams || []} presetOrgId={new URLSearchParams(loc.search).get("org") || ""} />)} />
            <Route path="/clients" element={<ClientsPage data={data} />} />
            <Route path="/teams" element={guard(can(me, "team.view"), "teams", <TeamsPage data={data} />)} />
            <Route path="/activity" element={<ActivityPage data={data} />} />
            <Route path="/notifications" element={<NotificationsPage data={data} onRefresh={refresh} />} />
            <Route path="/settings" element={<SettingsPage me={me} />} />
          </Routes>

          <footer>
            © 2026 Tendrils Operations
            <span><ShieldCheck size={14} /> Private, role-based workspace</span>
          </footer>
        </section>
      </main>

      {toast && (
        <div className={"toast " + (toast.type === "error" ? "bad" : "")} role="status">
          {toast.type === "error" ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          {toast.message}
          <button onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} /></button>
        </div>
      )}

      {modal && <EntityModal kind={modal} data={data} onClose={() => setModal("")} onSubmit={create} saving={saving} />}

      <TicketDrawer
        ticket={openTicket}
        comments={comments}
        me={me}
        users={data.users || []}
        teams={data.teams || []}
        onClose={() => setSelected(null)}
        onUpdate={(id, body) => update("tickets", id, body)}
        onAddComment={(body, visibility) => create("comment", { body, visibility })}
        onUpload={upload}
      />
    </div>
  );
}
