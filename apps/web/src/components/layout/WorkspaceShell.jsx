import React, { useCallback, useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle2, ShieldCheck, X } from "lucide-react";

import { api } from "../../api";
import { can } from "../../lib/rbac";
import NoAccess from "../ui/NoAccess";
import * as realtime from "../../lib/realtime";
import { uploadInline } from "../../lib/paste";
import { normalizePayload } from "../../lib/dates";
import { useDrawers } from "../../hooks/useTicketDrawer";

import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import PageHeader from "./PageHeader";
import EntityModal from "../forms/EntityModal";
import TicketDrawer from "../tickets/TicketDrawer";
import TaskDrawer from "../tasks/TaskDrawer";

import OverviewPage from "../../pages/OverviewPage";
import TicketsPage from "../../pages/TicketsPage";
import TasksPage from "../../pages/TasksPage";
import ProjectsPage from "../../pages/ProjectsPage";
import ClientsPage from "../../pages/ClientsPage";
import TeamsPage from "../../pages/TeamsPage";
import ActivityPage from "../../pages/ActivityPage";
import NotificationsPage from "../../pages/NotificationsPage";
import SettingsPage from "../../pages/SettingsPage";
import ChatPage from "../../pages/ChatPage";
// import UpdatesPage from "../../pages/UpdatesPage";
import NotesPage from "../../pages/NotesPage";
import RemindersPage from "../../pages/RemindersPage";
import AdminPage from "../../pages/AdminPage";
import ResourcesPage from "../../pages/ResourcesPage";

const pageMeta = {
  "/": ["Overview", "A clear view of client delivery, team ownership and what needs attention."],
  "/clients": ["Clients", "A separate, organized workspace for every client."],
  "/resources": ["Resources", "Documents, private reminders and personal notes in one place."],
  "/documents": ["Resources", "Documents, private reminders and personal notes in one place."],
  "/projects": ["Projects", "Track delivery, milestones and progress across client work."],
  "/tickets": ["Tickets", "Every request has an owner, a priority and a next step."],
  "/tasks": ["Tasks", "Your team’s work, deadlines and what needs attention."],
  "/chat": ["Chat", "Talk with your team, in General or per project."],
  "/reminders": ["Reminders", "Your private flags and reminders. Only you can see them."],
  "/notes": ["My notes", "Private notes that only you can see. Never emailed or shared."],
  // "/updates": ["Daily update", "Share what you did and what is next. Admins are notified."],
  "/admin": ["Admin console", "Daily updates, workload and activity across the team."],
  "/teams": ["Teams", "The people and disciplines behind the work."],
  "/activity": ["Activity log", "A traceable timeline of changes across the workspace."],
  "/notifications": ["Notifications", "Assignments, updates and reminders that need your attention."],
  "/settings": ["Settings", "Your access, WhatsApp, AI assistant (MCP) connections and security."],
};

/**
 * The signed-in workspace: sidebar + topbar + page routes + drawers/modals/toast.
 * App.jsx stays a thin gate (loader / sign-in / this shell); this component owns
 * everything a session needs.
 */
export default function WorkspaceShell({ data, refresh, setData }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const me = data.me;
  const path = loc.pathname;
  const internal = !!me?.isInternal;

  const d = useDrawers({ data, navigate, location: loc });
  const { modal, modalInit, openModal, closeModal, selected, setSelected, selectedTaskId, setSelectedTaskId, openTask, showTicket, closeAll, comments, loadComments, openTicket, openTaskRecord } = d;

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState(null);
  const note = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Layout state: desktop sidebar can collapse (remembered); on phones it is a slide-in drawer.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("tendrils.sidebar") === "collapsed");
  const [navOpen, setNavOpen] = useState(false);
  const toggleCollapsed = () => setCollapsed((c) => { localStorage.setItem("tendrils.sidebar", c ? "open" : "collapsed"); return !c; });
  useEffect(() => { setNavOpen(false); window.scrollTo(0, 0); }, [path]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { setNavOpen(false); if (!document.querySelector(".overlay, .win-overlay")) closeAll(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAll]);

  const [title, subtitle] = pageMeta[path] || pageMeta["/"];
  const unread = (data.notifications || []).filter((n) => !n.readAt).length;

  // Realtime: one WebSocket per signed-in session (notifications + chat).
  const meId = me?.user?.id;
  useEffect(() => {
    if (!meId) { realtime.disconnect(); return undefined; }
    realtime.connect();
    return realtime.on("notification", ({ notification }) => {
      setData((d0) => ({ ...d0, notifications: [notification, ...(d0.notifications || [])] }));
      note(notification.title);
    });
  }, [meId, note, setData]);

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

  // Refresh button: reload the workspace AND every widget that loads its own data, with visible feedback.
  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    realtime.emit("app.refresh", { silent: false });
    const ok = await refresh();
    setRefreshing(false);
    note(ok === false ? "Could not refresh. Check your connection." : "Up to date", ok === false ? "error" : "success");
  }, [refreshing, refresh, note]);

  const create = async (kind, payload) => {
    setSaving(true);
    let attachWarning = "";
    try {
      const { __files: pastedFiles = [], ...cleanPayload } = payload;
      const normalizedPayload = normalizePayload(cleanPayload);
      if (kind === "client") {
        await api.post("/organizations", normalizedPayload);
      } else if (kind === "comment") {
        await api.post(`/tickets/${selected.id}/comments`, normalizedPayload);
      } else {
        const endpoint = kind === "project" ? "/projects" : kind === "projectRequest" ? "/projects/request" : kind === "task" ? "/tasks" : "/tickets";
        const created = await api.post(endpoint, normalizedPayload);
        if (pastedFiles.length) {
          const targetKey = kind === "task" ? "taskId" : kind === "project" || kind === "projectRequest" ? "projectId" : "ticketId";
          const base = kind === "task" ? "tasks" : kind === "project" || kind === "projectRequest" ? "projects" : "tickets";
          let desc = cleanPayload.description || "";
          let relink = false;
          const failed = [];
          for (const { file, marker } of pastedFiles) {
            try {
              if (marker) { const r = await uploadInline(file, { [targetKey]: created.data.id }); desc = desc.replaceAll(`[[img:${marker}]]`, `[[img:${r.id}]]`); relink = true; }
              else { const fd = new FormData(); fd.append("file", file); fd.append(targetKey, created.data.id); await api.post("/files", fd); }
            } catch (err) { failed.push(`${file.name} (${err.response?.data?.error || "upload failed"})`); }
          }
          if (relink) await api.patch(`/${base}/${created.data.id}`, { description: desc }).catch(() => {});
          if (failed.length) attachWarning = `Saved, but ${failed.length} file(s) could not be attached: ${failed.join(", ")}. Open it and use Upload to retry.`;
        }
      }
      note(attachWarning || "Saved successfully", attachWarning ? "error" : "success");
      closeModal();
      if (kind === "comment") await loadComments();
      await refresh();
    } catch (err) {
      note(err.response?.data?.error || "Could not save. Check permissions and required fields.", "error");
    } finally {
      setSaving(false);
    }
  };

  const update = async (type, id, body) => {
    try {
      const res = await api.patch(`/${type}/${id}`, body);
      note(res.data?.autoUnassigned ? "Team updated — the previous assignee isn't in this team, so pick a new assignee." : "Updated");
      await refresh();
      if (type === "tickets" && selected) {
        setSelected((current) => (current ? { ...current, ...body } : current));
      }
      return true;
    } catch (err) {
      note(err.response?.data?.error || "Update failed", "error");
      return false;
    }
  };

  const deleteTicket = async (t) => {
    try {
      const res = await api.delete(`/tickets/${t.id}`);
      note(res.data?.detachedTasks ? `Ticket deleted. ${res.data.detachedTasks} linked task(s) were kept as standalone tasks.` : "Ticket deleted");
      setSelected(null);
      await refresh();
    } catch (err) {
      note(err.response?.data?.error || "Could not delete the ticket", "error");
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
      note("File uploaded");
      await refresh();
    } catch (err) {
      note(err.response?.data?.error || "Upload failed", "error");
    } finally {
      event.target.value = "";
    }
  };

  const newAction = () => {
    const target = { "/": "ticket", "/tickets": "ticket", "/tasks": "task", "/projects": can(me, "project.create") ? "project" : "projectRequest", "/clients": "client" }[path];
    if (target) openModal(target);
  };

  // Which primary button does this page offer for the current role?
  const action = {
    "/": can(me, "ticket.create") && "New ticket",
    "/tickets": can(me, "ticket.create") && "New ticket",
    "/tasks": can(me, "task.create") && "New task",
    "/projects": (can(me, "project.create") && "New project") || (can(me, "project.request") && "Request project"),
    "/clients": can(me, "org.create") && "New client",
  }[path] || null;

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
            onRefresh={refreshAll}
            refreshing={refreshing}
          />

          <Routes>
            <Route path="/" element={<OverviewPage data={data} onSelectTicket={setSelected} />} />
            <Route path="/tickets" element={<TicketsPage data={data} onSelect={setSelected} />} />
            <Route path="/tasks" element={guard(internal, "tasks", <TasksPage data={data} onCreate={() => openModal("task")} onOpen={openTask} onStatusChange={(task, status) => update("tasks", task.id, { status })} />)} />
            <Route path="/resources" element={<ResourcesPage me={me} notify={note} onOpenTicket={(t) => { navigate("/tickets"); setSelected(t); }} />} />
            <Route path="/documents" element={<ResourcesPage me={me} notify={note} />} />
            <Route path="/projects" element={<ProjectsPage data={data} onRefresh={refresh} notify={note} />} />
            <Route path="/chat" element={guard(can(me, "chat.use"), "team chat", <ChatPage me={me} users={data.users || []} notify={note} />)} />
            <Route path="/reminders" element={guard(internal, "reminders", <RemindersPage notify={note} onOpenTicket={(t) => { navigate("/tickets"); setSelected(t); }} />)} />
            <Route path="/notes" element={guard(internal, "my notes", <NotesPage notify={note} />)} />
            {/* <Route path="/updates" element={guard(can(me, "update.post"), "daily updates", <UpdatesPage notify={note} onRefresh={refresh} />)} /> */}
            <Route path="/admin" element={guard(can(me, "admin.view"), "the admin console", <AdminPage me={me} notify={note} orgs={data.organizations || []} teams={data.teams || []} presetOrgId={new URLSearchParams(loc.search).get("org") || ""} />)} />
            <Route path="/clients" element={<ClientsPage data={data} />} />
            <Route path="/teams" element={guard(can(me, "team.view"), "teams", <TeamsPage data={data} me={me} onRefresh={refresh} notify={note} />)} />
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

      {modal && <EntityModal key={modal + (modalInit?.ticketId || "") + (modalInit?.parentId || "")} kind={modal} data={data} initial={modalInit} onClose={closeModal} onSubmit={create} saving={saving} />}

      <TicketDrawer
        ticket={openTicket}
        comments={comments}
        me={me}
        users={data.users || []}
        teams={data.teams || []}
        tasks={data.tasks || []}
        onAddTask={(t) => openModal("task", { organizationId: t.organization?.id || t.organizationId, ticketId: t.id, teamId: t.teamId || "", projectId: t.projectId || t.project?.id || "" })}
        onOpenTask={openTask}
        onRefresh={refresh}
        notify={note}
        onDelete={deleteTicket}
        onClose={() => setSelected(null)}
        onUpdate={(id, body) => update("tickets", id, body)}
        onAddComment={(body, visibility) => create("comment", { body, visibility })}
        onUpload={upload}
      />

      <TaskDrawer
        task={openTaskRecord}
        tasks={data.tasks || []}
        tickets={data.tickets || []}
        me={me}
        onClose={() => setSelectedTaskId(null)}
        onStatusChange={(t, status) => update("tasks", t.id, { status })}
        onOpenTask={openTask}
        teams={data.teams || []}
        onOpenTicket={showTicket}
        onRefresh={refresh}
        notify={note}
        onAddSubtask={(t) => openModal("task", { organizationId: t.organizationId, parentId: t.id, teamId: t.teamId || "", projectId: t.projectId || "" })}
      />
    </div>
  );
}
