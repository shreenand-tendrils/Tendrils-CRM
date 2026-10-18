import { NavLink } from "react-router-dom";
import { LogOut, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Brand from "../ui/Brand";
import Avatar from "../ui/Avatar";
import DevLogin from "../dev/DevLogin";
import { primaryNavigation, adminNavigation, utilityNavigation } from "../../lib/navigation";
import { can, ROLE_LABELS, topRole } from "../../lib/rbac";

async function signOut() {
  try {
    const { csrfToken } = await fetch("/auth/csrf", { credentials: "include" }).then((r) => r.json());
    await fetch("/auth/signout", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: window.location.origin, json: "true" }),
    });
  } finally {
    window.location.reload();
  }
}

// Fixed viewport sidebar; only the navigation region scrolls. Desktop can collapse it to icons; phones use a drawer.
export default function Sidebar({ me, unread, chatUnread = 0, collapsed, onToggleCollapse, onNavigate }) {
  const badge = (to) => (to === "/notifications" ? unread : to === "/chat" ? chatUnread : 0);
  const item = (n) => {
    const count = badge(n.to);
    return (
      <NavLink key={n.to} to={n.to} end={n.to === "/"} title={collapsed ? n.label : undefined} onClick={onNavigate}
        className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
        <span className="nav-icon"><n.icon size={20} /></span>
        <span className="label">{n.label}</span>
        {count > 0 && <i>{count > 99 ? "99+" : count}</i>}
      </NavLink>
    );
  };

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand-row">
        <Brand />
        <button className="side-toggle" onClick={onToggleCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </button>
        <button className="side-close" onClick={onNavigate} aria-label="Close menu"><X size={20} /></button>
      </div>

      <div className="nav-scroll">
        <label className="nav-label">WORKSPACE</label>
        <nav>{primaryNavigation.filter((n) => !n.staff || me?.isInternal).map(item)}</nav>
        {can(me, "admin.view") && (<><label className="nav-label">ADMIN</label><nav>{adminNavigation.map(item)}</nav></>)}
        <label className="nav-label">ACCOUNT</label>
        <nav>{utilityNavigation.map(item)}</nav>
      </div>

      <div className="side-bottom">
        <DevLogin variant="switcher" />
        <div className="user">
          <Avatar name={me?.user?.name || me?.user?.email} />
          <span>
            <b>{me?.user?.name || "Tendrils member"}</b>
            <small>{me?.user?.email}</small>
            <em className="role-pill">{ROLE_LABELS[topRole(me)] || "Member"}</em>
          </span>
          <button title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={18} /></button>
        </div>
      </div>
    </aside>
  );
}
