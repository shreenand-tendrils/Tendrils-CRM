import { Bell, ChevronRight, Menu, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Avatar from "../ui/Avatar";
import { useAppStore } from "../../store";

export default function Topbar({ title, me, hasUnread, onMenu, showSearch }) {
  const navigate = useNavigate();
  const { search, setSearch } = useAppStore();
  return (
    <header className="topbar">
      <button className="menu-btn" onClick={onMenu} aria-label="Open menu"><Menu size={22} /></button>
      <div className="crumb"><span>Workspace</span><ChevronRight size={14} /><b>{title}</b></div>
      <div className="header-right">
        {showSearch && <label className="search"><Search size={17} /><input aria-label="Search" placeholder="Search tickets, tasks, projects…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>}
        <button className="icon" aria-label="Notifications" onClick={() => navigate("/notifications")}><Bell size={20} />{hasUnread && <i />}</button>
        <Avatar name={me?.user?.name || me?.user?.email} />
      </div>
    </header>
  );
}
