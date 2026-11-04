# Ticket → Task → Subtask flow (v4.8.27)

One sentence: **the ticket is the request, tasks are the work, subtasks are the doer's checklist — and every top-level task has exactly one reviewer.**

## 1. The three levels

| Level | What it is | Who sees it | Who finishes it |
|---|---|---|---|
| **Ticket** | The request (client's or another team's). Has an owning team, optional participating teams, one assignee (the lead). | Client, teams on it | Closed by the client (client tickets) or by employees (team-to-team tickets) |
| **Task** | A piece of work planned under the ticket. Assigned to people of the team(s). | Teams on it; the client sees it read-only on the ticket | Submitted to **Review**; the reviewer approves |
| **Subtask** | A step inside a task (checklist). | The task's team | The doer ticks it **Done** directly. No review. |

The ticket's old auto-created "main task" still exists in the database (it keeps ticket status and the assignee's workload in sync) but is **never shown** any more: not on the board, not in the ticket, not in the route. You work on the ticket's *real* tasks.

## 2. Who reviews a task (`reviewBy`, decided by the API)

| Situation | Reviewer | Notes |
|---|---|---|
| Subtask | nobody | Parent can't go to Review until all its subtasks are Done |
| Task on a **client ticket** | **the client** | Approve, or ask for changes with a note |
| Task one team sent to another | the **requesting team** | (existing rule) |
| Task someone else created for you, same team | a **teammate** who is not an assignee (or the creator) | no more "only admin can finish it" deadlock |
| Task you created for yourself / unassigned | nobody | mark Done directly |
| Platform admin | can finish/reopen any task | except the ticket's hidden record |

### Who may change a task's status
* **Only the people the task is assigned to** (plus platform admins). A subtask can also be ticked by the assignee of its parent task. Teammates, and even the creator, can read and comment but not move it.
* If **nobody is assigned yet**, a teammate of the task's team can pick it up (move it).
* The **reviewer** (teammate for PEER, requesting team for TEAM) can only act on work in **Review**: *Approve* or *Send back*; and reopen a Done task. The client reviews client-ticket tasks from the ticket.
* **Same rule team-to-team.** Task sent from Team A to Team B: only the Team B person it is assigned to (or an unowned task's Team B teammate) moves it; Team A (the requester) can only *Approve* or *Send back* once it is in Review, and nobody approves their own work, even if they sit in both teams. New tasks cannot be created already in Review/Done.
* Buttons and dropdown options that you may not use are disabled with the reason ("only the assignee", "client approves", …).

## 3. The client-ticket journey

1. Client raises a ticket → picks the team → it lands **Open / unassigned** in that team's queue; team members are notified.
2. A team member takes it (assignee). The hidden record appears; ticket shows Open · In progress.
3. The lead adds **tasks** (ticket page → *Add linked task*) and the doers add **subtasks** inside each task (checklist, press Enter).
4. A doer finishes the subtasks → **Submit for review** on the task.
   * the task shows "Waiting for client" on the board;
   * the ticket moves to **Open · QA** ("Being tested" for the client);
   * the client gets a notification + email; on their ticket, the **Tasks** tab opens with *Approve* / *Ask for changes*.
5. Client **approves** → task Done. Client **asks for changes** → task goes back to *In progress*, the note is posted as a client-visible comment on the ticket and as a comment on the task, the team is notified.
6. When the client approves the **last** open task, the **ticket closes automatically** (history event, team notified, hidden record becomes Done). The choice lives in one constant, `ON_LAST_APPROVAL` in `apps/api/src/services/taskClientReview.js`: `'CLOSED'` (default) or `'REVIEW_TEST'` if you want the client to give one more final OK.

### Ticket statuses (team sets them; tasks move them only in the two cases below)
| Status | Meaning | Rule |
|---|---|---|
| Open (In progress / Being tested) | Work running; tasks live under it | "Being tested" is set automatically while a task waits for the client |
| **Review/Test** | Whole ticket is ready; client gives the final OK or sends it back | Allowed only when **all tasks are Done** |
| **Review/Help** | Team is blocked and needs information from the client | No task condition; client is notified to reply; hidden record shows Blocked |
| Closed | Finished | Allowed only when all tasks are Done |

**Automatic moves:** last task approved by the client → ticket Closed (or Review/Test, see above). A **new task added while the ticket is in Review/Test** → ticket goes back to Open · In progress. A task in client review → Open · Being tested. Everything else is manual.

A ticket with no tasks can still go to Review/Test directly. If an admin marks a client task Done directly, the ticket is moved to Review/Test for the client.

## 4. Team-to-team journey

Ticket/task is created for another team → that team's members are notified → they plan tasks/subtasks → they submit to Review → the **requesting team** approves → Done. Same subtask rule inside the receiving team.

## 5. Sync rules (what moves what)

* Task → Review (client ticket): ticket progress → QA, history event "submitted for review", client notified.
* Client approve / changes: task status, ticket progress, history, comments and notifications are written **in one database transaction**. The note box accepts pasted screenshots.
* Ticket status → hidden record status (existing mapping) and the reverse, guarded so they never ping-pong.
* Every screen re-reads the workspace **every 20 s while visible and when you return to the tab**, so a client's approval shows up for the team without a manual refresh.

## 6. API additions

* `POST /api/tickets/:id/tasks/:taskId/review` — client only. Body `{ "decision": "APPROVE" | "CHANGES", "note": "…" }` (note required for CHANGES). Returns `{ task, ticketStatus, allApproved }`.
* `GET /api/tasks` rows now include `reviewBy` (`NONE | CLIENT | TEAM | PEER | TICKET`).
* `GET /api/tickets` rows now include `tasksInReview`.
* `GET /api/tickets/:id/tasks` no longer returns the hidden record.
* New history event type `TASK_REVIEW` (`REQUESTED | APPROVED | CHANGES`).
* New guards: no subtasks under a task that is in Review/Done, none under the hidden record; subtasks inherit the parent's ticket and project.

No Prisma migration is needed.
