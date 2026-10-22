import { useState } from "react";
import { Files, Flag, Lock } from "lucide-react";
import DocumentsPage from "./DocumentsPage";
import RemindersPage from "./RemindersPage";
import NotesPage from "./NotesPage";

// Keep related personal/workspace utilities in one navigable destination.
export default function ResourcesPage({ me, notify, onOpenTicket }) {
  const [tab, setTab] = useState("documents");
  const tabs = [
    { id: "documents", label: "Documents", icon: Files },
    ...(me?.isInternal ? [
      { id: "reminders", label: "Reminders", icon: Flag },
      { id: "notes", label: "My notes", icon: Lock },
    ] : []),
  ];
  return <section className="resources-hub">
    <div className="tabs" role="tablist" aria-label="Workspace resources">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab on" : "tab"} onClick={() => setTab(id)}><Icon size={15} /> {label}</button>)}
    </div>
    {tab === "documents" && <DocumentsPage me={me} notify={notify} />}
    {tab === "reminders" && me?.isInternal && <RemindersPage notify={notify} onOpenTicket={onOpenTicket} />}
    {tab === "notes" && me?.isInternal && <NotesPage notify={notify} />}
  </section>;
}
