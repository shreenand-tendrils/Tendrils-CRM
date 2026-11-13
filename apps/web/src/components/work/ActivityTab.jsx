import { GitBranch, History } from "lucide-react";
import WorkThread from "./WorkThread";
import TicketHistory from "../tickets/TicketHistory";

/** Route (who holds the work, which tasks branch off) and History (every change) together: one place to see how a ticket moved. */
export default function ActivityTab({ ticket, tasks, onOpenTask, refreshKey, showRoles }) {
  return (
    <div className="activity">
      <section className="act-sec">
        <h4 className="act-h"><GitBranch size={15} /> Route</h4>
        <WorkThread ticket={ticket} ticketId={ticket.id} currentTicket tasks={tasks} onOpenTask={onOpenTask} refreshKey={refreshKey} hideEvents />
      </section>
      <section className="act-sec">
        <h4 className="act-h"><History size={15} /> History</h4>
        <TicketHistory ticketId={ticket.id} showRoles={showRoles} refreshKey={refreshKey} filterable />
      </section>
    </div>
  );
}
