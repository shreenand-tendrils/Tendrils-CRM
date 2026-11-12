import { Users } from "lucide-react";

/** "+2" next to the assignee when a ticket has collaborators; hover/long-press shows who. Renders nothing otherwise. */
export default function CollaboratorBadge({ ticket }) {
  const list = (ticket?.collaborators || []).map((c) => c.user?.name || c.user?.email).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="collab-badge" title={`Collaborators: ${list.join(", ")}`} aria-label={`${list.length} collaborator${list.length === 1 ? "" : "s"}: ${list.join(", ")}`}>
      <Users size={12} aria-hidden="true" />+{list.length}
    </span>
  );
}
