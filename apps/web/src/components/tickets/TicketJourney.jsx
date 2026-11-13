import { Check, PauseCircle } from "lucide-react";
import Avatar from "../ui/Avatar";
import { PROGRESS_LABEL, clientStatusText, daysPassed, dayLabel } from "../../lib/ticketStatus";
import { fmtDate } from "../../lib/dates";

const DAY = 86400000;

// Where the ticket is: a 3-step track (Open -> Review -> Closed) with the current step marked.
function Track({ ticket, staff }) {
  const help = ticket.status === "REVIEW_HELP";
  const cur = ticket.status === "CLOSED" ? 2 : ticket.status === "REVIEW_TEST" ? 1 : 0;
  const names = staff ? ["Open", "Review / Test", "Closed"] : ["In progress", "Your review", "Closed"];
  const sub = staff
    ? [ticket.status === "OPEN" ? (ticket.progress ? PROGRESS_LABEL[ticket.progress] : "Not started") : "", ticket.status === "REVIEW_TEST" ? "Waiting for approval" : "", ticket.status === "CLOSED" ? "Done" : ""]
    : [ticket.status === "OPEN" ? clientStatusText(ticket) : "", ticket.status === "REVIEW_TEST" ? "Please approve or send back" : "", ticket.status === "CLOSED" ? "Done" : ""];
  return (
    <>
      <ol className="tw-track" aria-label="Ticket progress">
        {names.map((n, i) => (
          <li key={n} className={i < cur || cur === 2 ? "done" : i === cur ? "now" : ""} aria-current={i === cur ? "step" : undefined}>
            <span className="tw-step">{i < cur || cur === 2 ? <Check size={14} /> : i + 1}</span>
            <span className="tw-step-text"><b>{n}</b>{sub[i] && <small>{sub[i]}</small>}</span>
          </li>
        ))}
      </ol>
      {help && <p className="tw-hold"><PauseCircle size={15} /> {staff ? "On hold: Review / Help. The team needs more information from the client." : "On hold: we need more information from you. Please answer in the comments."}</p>}
    </>
  );
}

const Fact = ({ label, children, warn }) => <div className={"tw-fact" + (warn ? " warn" : "")}><small>{label}</small><div>{children}</div></div>;

export default function TicketJourney({ ticket, staff, teamName, sharedNames, workDone, workTotal, inReview }) {
  const open = ticket.status !== "CLOSED";
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const late = open && ticket.dueDate ? Math.floor((today - new Date(ticket.dueDate)) / DAY) : 0;
  const person = ticket.assignee?.name || ticket.assignee?.email;
  const collabs = (ticket.collaborators || []).map((c) => c.user?.name || c.user?.email).filter(Boolean);
  return (
    <section className="tw-journey" aria-label="Where this ticket stands">
      <Track ticket={ticket} staff={staff} />
      <div className="tw-facts">
        {staff && (
          <Fact label="Team" warn={!teamName}>
            {teamName ? <><b>{teamName}</b>{sharedNames.length > 0 && <small>shared with {sharedNames.join(", ")}</small>}</> : <b>Not routed yet</b>}
          </Fact>
        )}
        <Fact label={staff ? "Assignee" : "Handled by"} warn={!person}>
          {person ? <span className="tw-who"><Avatar name={person} /><b>{person}</b></span> : <b>{staff ? "Unassigned" : "Not assigned yet"}</b>}
        </Fact>
        {staff && <Fact label="Collaborators"><b>{collabs.length ? collabs.join(", ") : "None"}</b></Fact>}
        {staff && <Fact label="Tasks">{workTotal ? <><b>{workDone} of {workTotal} done</b>{inReview > 0 && <small>{inReview} waiting for review</small>}</> : <b>None yet</b>}</Fact>}
        <Fact label="Due" warn={late > 0}>
          <b>{fmtDate(ticket.dueDate, "No due date")}</b>
          {late > 0 && <small>{late} day{late === 1 ? "" : "s"} overdue</small>}
        </Fact>
        <Fact label={ticket.closedAt ? "Closed in" : "Open for"}><b>{dayLabel(daysPassed(ticket))}</b></Fact>
      </div>
    </section>
  );
}
