import { useEffect, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { api } from "../../api";
import { StatusBadge } from "../ui/StatusBadge";
import { formatDate } from "../../lib/formatters";
import RichText from "../ui/RichText";
import PasteTextarea from "../ui/PasteTextarea";
import "../../styles/workflow.css";

// What the client sees behind a ticket: the team's tasks with their subtasks as a checklist.
// A task in Review waits for THIS person: approve it, or send it back with what to change.
// Approving the last open task closes the ticket (the client has now reviewed all of the work).
export default function TicketTasks({ ticketId, refreshKey, canReview = false, onChanged, notify }) {
  const [rows, setRows] = useState(null);
  const [asking, setAsking] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/tickets/${ticketId}/tasks`).then((r) => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, [ticketId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <p className="hint">Loading tasks…</p>;
  if (!rows.length) return <p className="hint">No tasks yet. They appear here once the team plans the work.</p>;

  const review = async (task, decision) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/tickets/${ticketId}/tasks/${task.id}/review`, { decision, note: decision === "CHANGES" ? note : undefined });
      notify?.(decision === "APPROVE" ? (data.closed ? "Approved — all tasks are done, the ticket is closed" : data.allApproved ? "Approved — all tasks are done" : "Approved") : "Sent back to the team");
      setAsking(null); setNote("");
      await load(); onChanged?.();
    } catch (err) { notify?.(err.response?.data?.error || "Could not save your review", "error"); } finally { setBusy(false); }
  };

  const roots = rows.filter((t) => !t.parentId);
  const kidsOf = (id) => rows.filter((t) => t.parentId === id);
  const done = roots.filter((t) => t.status === "DONE").length;
  return (
    <div className="review-rows">
      <div className="ticket-progress"><small className="muted">{done} of {roots.length} task{roots.length === 1 ? "" : "s"} approved</small><div className="progress" aria-hidden="true"><i style={{ width: `${Math.round((done / roots.length) * 100)}%` }} /></div></div>
      {roots.map((t) => {
        const people = (t.assignees || []).map((a) => a.user?.name || a.user?.email).filter(Boolean);
        const kids = kidsOf(t.id);
        const waiting = canReview && t.status === "REVIEW";
        return (
          <div className={"review-row" + (waiting ? " asks" : "")} key={t.id}>
            <div className="top"><b>{t.title}</b><StatusBadge value={t.status} /></div>
            {t.description && <RichText text={t.description} style={{ fontSize: 13 }} />}
            {kids.length > 0 && <ul className="kids">{kids.map((k) => <li key={k.id} className={k.status === "DONE" ? "done" : ""}>{k.title}</li>)}</ul>}
            <small className="muted">{t.team?.name ? `${t.team.name} · ` : ""}{people.length ? people.join(", ") : "Unassigned"} · Due {formatDate(t.dueDate)}</small>
            {waiting && (asking === t.id ? (
              <div className="review-actions">
                <PasteTextarea rows={3} value={note} onChange={setNote} target={{ ticketId }} onError={(m) => notify?.(m, "error")} placeholder="What should the team change? You can paste screenshots here." aria-label="What should change" />
                <button className="primary" disabled={busy || note.trim().length < 2} onClick={() => review(t, "CHANGES")}>Send back</button>
                <button className="secondary" onClick={() => { setAsking(null); setNote(""); }}>Cancel</button>
              </div>
            ) : (
              <div className="review-actions">
                <button className="primary" disabled={busy} onClick={() => review(t, "APPROVE")}><Check size={14} /> Approve</button>
                <button className="secondary" disabled={busy} onClick={() => setAsking(t.id)}><Undo2 size={14} /> Ask for changes</button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
