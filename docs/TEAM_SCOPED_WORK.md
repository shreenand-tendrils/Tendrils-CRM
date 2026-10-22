# Team-scoped tickets, task distribution, and subtasks

## Security contract

- An internal ticket is visible only to members of a team explicitly linked to that ticket in `TicketTeamAccess`.
- The ticket's `teamId` is its owning team. `TicketTeamAccess` includes the owner plus any participating teams. A third team cannot discover the ticket from list, detail, comments, activity feed, or attachment routes unless it is explicitly added.
- Platform Admin is the explicit global-oversight exception. Managers/managers can route and reassign work only when they can access the ticket through one of their participating teams or it is still unrouted and their triage permission allows routing.
- Client access remains organization/requester/visibility-based; internal team membership does not grant client users access to internal work.
- Adding or removing participating teams requires `ticket.triage` or `task.assign`. A normal employee can create work for their own team(s), but cannot share it with another team.

## Team first, then assignee

- Routing a ticket means choosing its **owning team** first. The assignee must be an active member of the owning team or of a participating team (`ASSIGNEE_NOT_IN_TEAM`, 400). Assigning with no team returns `TICKET_NOT_ROUTED` (409).
- Changing the owning team clears an assignee who is not in the new teams (the response has `autoUnassigned: true`, the UI shows a toast, and the activity log records it).
- Tasks follow the same rule: assignees must belong to the task's owner/shared/ticket/parent teams. Moving a task to other teams removes assignees who no longer fit.
- UI: owner team dropdown at the top, a checkbox dropdown for shared teams, **Save team access**, then an assignee dropdown built from the saved teams (ticket drawer). Create ticket/task forms use the same order live.
- Pure rules live in `apps/api/src/services/ticketRouting.js` and are covered by `test/ticketRouting.test.js`.

## Why a ticket must never "disappear"

A ticket stays visible to: members of its teams, Platform Admin, **its current assignee**, and **the triager who routed it** (`TicketTeamAccess.addedById`), in addition to triagers while it is unrouted. Team access is updated by diffing (not delete-all), so the `addedById` trail is preserved when participants are edited.

## Data model

- `Ticket.teamId`: owning team (nullable for incoming client tickets until triage).
- `TicketTeamAccess(ticketId, teamId)`: explicit ticket access boundary. `accessRole` distinguishes owner from participant.
- `Task.teamId`: owning team for independent tasks and subtasks.
- `TaskTeamAccess(taskId, teamId)`: explicit task boundary. Ticket-generated tasks inherit the ticket's participating teams; subtasks inherit parent access at creation.
- `Task.parentId`: parent/subtask hierarchy. The parent cannot be marked `DONE` while any descendant is unfinished. A ticket cannot be resolved/closed while any linked non-automatic task or descendant is unfinished.

## API payloads

Ticket create/update (authorized internal triage):

```json
{
  "teamId": "team-owner-id",
  "teamIds": ["team-participant-id"]
}
```

`teamIds` lists additional participating teams. The owner team is added automatically. Omit `teamIds` to avoid sharing with other teams.

Task create/update (authorized task assigner):

```json
{
  "teamId": "team-owner-id",
  "teamIds": ["team-participant-id"],
  "parentId": "parent-task-id"
}
```

The task's team access is the union of its owner/additional teams and its linked ticket/parent's access. Access is always checked server-side; UI filtering is not treated as a security boundary.

## Migration

Migration `20261021100000_team_scoped_work` is additive. It creates the access join tables, adds `Task.teamId`, and backfills existing owner-team access and inherited ticket/subtask access. Apply using `npm run db:deploy`, then regenerate Prisma Client using `npm run db:generate`.

## Verification checklist

1. Add a user to Team A, another to Team B, and a third to Team C.
2. Create a ticket shared with A and B. A and B can list/open/comment/upload; C receives no result and detail/file requests return not found.
3. Remove B from `TicketTeamAccess`; B loses access immediately. Re-add B explicitly to restore it.
4. Create a task shared with A and B and verify C cannot list/open/update/download attachments for it.
5. Create a parent task and subtask. Parent cannot become `DONE` until every descendant is `DONE`.
6. Link work to a ticket. Ticket cannot be resolved/closed while any linked non-automatic task or subtask remains unfinished.
7. Verify a platform admin retains oversight and client users continue to see only permitted client-visible ticket data.


## Ticket history and personal updates
- Ticket history lives in the `TicketEvent` table (migration `20261022090000_ticket_history`, which back-fills a CREATED event for existing tickets). `GET /tickets/:id/history` follows ticket access scope. Events store names as text, so they stay readable after renames. Clients only get events flagged `clientVisible` (created, status in client wording, client comments, attachments, title/due date/priority); team, assignee, sharing, visibility, project and internal notes are staff-only. The UI is the *History* tab in the ticket drawer.
- Daily updates (the Updates page is currently switched off in the nav) are visible to admins via the admin console and the activity log. No email or notification is sent by the API.
- **My notes** (`/notes`, table `PrivateNote`, migration `20261023090000_private_notes`) are strictly author-only: no email, no notification, no activity-log entry, and no admin/manager route reads them. `test/notes.test.js` fails if the notes route ever imports mail/notify/activity code or if any other file touches the table.
- Ticket comments support pasted clipboard images and PDFs as attachments.


## v4.8.10: team-to-team work and the route thread
- New permission `work.cross_team` ("Raise tickets and create tasks for other teams"): held by Employee, Manager and Platform admin. It lets an employee choose ANY internal team as owner, share with other teams, and pick assignees from those teams when creating a ticket or task. It does not grant triage (editing other people's tickets) or `task.assign` (changing assignees later).
- Whoever raises a ticket (or creates a task) for another team keeps seeing it, even though they are not in that team (`requesterId` / `creatorId` clauses in `ticketScope` / `taskTeamScope`). A task created for a team you are not in is not forced onto you: it stays unassigned and that team's managers are notified. Same notice for tickets routed to another team.
- Linked tasks: the ticket drawer lists every task linked to the ticket and has **Add linked task** (prefills client, ticket, team and project). Adding one writes a `TASK` event to the ticket history.
- Route thread (git-graph style): ticket drawer **Route** tab and the new task drawer show ticket -> teams -> assignee -> tasks -> subtasks. Click a task to open it, click the ticket from a task to jump back. Tasks page cards and rows open the task drawer. Notification links `/?ticket=ID` and `/?task=ID` now open the right drawer.
- Subtasks: "Add subtask" in the task drawer (not on auto tasks, which only mirror their ticket).

## v4.8.11: task comments
`GET/POST /tasks/:id/comments`, `DELETE /tasks/:id/comments/:commentId`, `GET /tasks/:id/attachments`. Comments are always internal, follow the task's team scope, need `ticket.comment_internal` to post, notify the creator and assignees in-app (no email), and are logged in the activity log. Authors (or anyone with `task.update_any`) can delete.

## v4.8.13: client team choice, project teams, team admin
- Clients choose teams (only teams marked `clientVisible`) on a ticket: first = owner, others shared. The managers of those teams are notified; no choice (or a team with no manager) means all managers are notified.
- `POST /projects/request` (`project.request`, client roles): creates a PLANNING project with `ProjectTeam` rows, adds those teams' managers as members and notifies them. Staff can set/replace project teams via `POST /projects` (`teamIds`) and `PUT /projects/:id/members` (`teamIds`).
- `team.manage` (Platform admin only) covers: `POST /teams`, `PATCH /teams/:id`, `DELETE /teams/:id` (archives when the team has history), `PUT /teams/:id/members`, `GET /teams/candidates`, and putting people in teams from invitations or the admin console. `GET /teams/requestable` lists names only for any signed-in user.
- Archived teams (`isActive=false`) cannot receive new tickets, tasks or members; old work keeps its team trail.
