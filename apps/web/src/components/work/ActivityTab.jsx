import WorkThread from "./WorkThread";
import TicketHistory from "../tickets/TicketHistory";

/** Timeline: the tasks branched off the ticket (only when there are any), then every change, newest first. The route itself sits in the ticket's header strip. */
export default function ActivityTab({ ticket, tasks, onOpenTask, refreshKey, showRoles }) {
  const hasTasks = tasks.some((t) => !t.autoCreated);
  return (
    <div className="activity">
      {hasTasks && (
        <section className="act-sec">
          <h4 className="act-h">Linked tasks</h4>
          <WorkThread ticket={ticket} ticketId={ticket.id} currentTicket tasks={tasks} onOpenTask={onOpenTask} refreshKey={refreshKey} hideEvents bare />
        </section>
      )}
      <section className="act-sec">
        <h4 className="act-h">History</h4>
        <TicketHistory ticketId={ticket.id} showRoles={showRoles} refreshKey={refreshKey} filterable />
      </section>
    </div>
  );
}
