import { useEffect, useRef, useState } from "react";
import { BookOpen, Bell, ChevronRight, Megaphone, Menu, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Avatar from "../ui/Avatar";
import { useAppStore } from "../../store";

export default function Topbar({ title, me, hasUnread, onMenu, showSearch, onBroadcast }) {
  const navigate = useNavigate();
  const { search, setSearch } = useAppStore();
  const [searchOpen, setSearchOpen] = useState(false); // phones: search folds into an icon so the sticky bar stays one row
  const searchRef = useRef(null);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  return (
    <header className="topbar">
      <button className="menu-btn" onClick={onMenu} aria-label="Open menu"><Menu size={22} /></button>
      <div className="crumb"><span>Workspace</span><ChevronRight size={14} /><b>{title}</b></div>
      <div className="header-right">
        {showSearch && <button type="button" className="icon search-toggle" aria-label="Search" aria-expanded={searchOpen || !!search} onClick={() => setSearchOpen((o) => !o)}><Search size={20} />{!!search && <i />}</button>}
        {showSearch && <label className={`search${searchOpen || search ? " open" : ""}`}><Search size={17} /><input ref={searchRef} aria-label="Search" placeholder="Search tickets, tasks, projects…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>}
        <button className="icon" aria-label="Notifications" onClick={() => navigate("/notifications")}><Bell size={20} />{hasUnread && <i />}</button>
        {onBroadcast && <button className="icon" aria-label="Broadcast or ping" title="Broadcast or ping" onClick={onBroadcast}><Megaphone size={20} /></button>}
        <button className="icon" aria-label="Guide" title="Guide: how to use Tendrils" onClick={() => navigate("/guide")}><BookOpen size={20} /></button>
        <Avatar name={me?.user?.name || me?.user?.email} />
      </div>
    </header>
  );
}
