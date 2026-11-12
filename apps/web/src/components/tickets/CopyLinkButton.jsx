import { useEffect, useRef, useState } from "react";
import { Check, Link2, XCircle } from "lucide-react";
import { copyText, ticketUrl } from "../../lib/ticketLink";

/** Copies the ticket's link. Safe inside clickable cards/rows: it never opens the ticket itself. */
export default function CopyLinkButton({ ticket, label = false }) {
  const [state, setState] = useState("idle"); // idle | done | fail
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyText(ticketUrl(ticket));
    setState(ok ? "done" : "fail");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };
  const text = state === "done" ? "Link copied" : state === "fail" ? "Copy failed" : "Copy link";
  const Icon = state === "done" ? Check : state === "fail" ? XCircle : Link2;
  return (
    <button type="button" className={`copy-link ${state}${label ? " with-label" : ""}`} onClick={copy}
      onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}
      title={state === "idle" ? "Copy ticket link" : text} aria-label={`${text}: ${ticket.key || "ticket"}`}>
      <Icon size={15} />{label && <span>{text}</span>}
      <span className="sr-only" role="status">{state === "idle" ? "" : text}</span>
    </button>
  );
}
