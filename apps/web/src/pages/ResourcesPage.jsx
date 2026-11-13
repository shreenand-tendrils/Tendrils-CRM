import { useState } from "react";
import { Files, Flag, Lock } from "lucide-react";
import DocumentsPage from "./DocumentsPage";
import RemindersPage from "./RemindersPage";
import NotesPage from "./NotesPage";

// Keep related personal/workspace utilities in one navigable destination.
export default function ResourcesPage({ me, notify, onOpenTicket }) {
  const [tab, setTab] = useState("documents");
  const tabs = [
    { id: "documents", label: "Documents", hint: "Shared files for the workspace", icon: Files },
    ...(me?.isInternal ? [
      { id: "reminders", label: "Reminders", hint: "Flags and reminders only you can see", icon: Flag },
      { id: "notes", label: "My notes", hint: "Private notes, visible only to you", icon: Lock },
    ] : []),
  ];
  const current = tabs.find((t) => t.id === tab) || tabs[0];
  return <section className="resources-hub">
    <div className="res-head">
      <div className="seg seg-lg" role="tablist" aria-label="Workspace resources">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`seg-btn${tab === id ? " on" : ""}`} onClick={() => setTab(id)}><Icon size={16} /> {label}</button>)}
      </div>
      <span className="res-sub">{current.hint}</span>
    </div>
    {tab === "documents" && <DocumentsPage me={me} notify={notify} />}
    {tab === "reminders" && me?.isInternal && <RemindersPage notify={notify} onOpenTicket={onOpenTicket} />}
    {tab === "notes" && me?.isInternal && <NotesPage notify={notify} />}
  </section>;
}
