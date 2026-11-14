# Tendrils CRM 4.9.20: ticket collaborators (add-on)
A ticket keeps its single assignee and team routing exactly as before. It can now ALSO have any number of collaborators, picked from the members of ALL the ticket's teams (owner team + shared teams), regardless of which of those teams each person is in.

## Database (run before starting the new API)
- New table `TicketCollaborator` (migration `20261121090000_ticket_collaborators`). Nothing existing is altered.
- `npm --workspace apps/api run db:deploy` then `npm --workspace apps/api run db:generate`.

## Rules
- Who can manage: the same people who can route/assign the ticket (triagers/admins, and team members with route permission on that ticket).
- Collaborators must belong to one of the ticket's teams. Changing the teams removes collaborators who no longer belong (they are told, the history records why). The assignee is never also a collaborator.
- Collaborators can open the ticket from any team, comment, and update its status (same as the assignee). They also share the ticket's own task, so it shows in their task list.
- Clients never see collaborators.

## Email and notifications
- New collaborators get an in-app notification and a drafted email (ticket, priority, due date, team(s), assignee, who else is on it, link). Removed people get an in-app note only.
- Collaborators are included in comment and status notifications; people added as collaborators are not double-mailed by the "sent to your team" mail.

## Screens
- New ticket form: optional "Collaborators" picker (people of the selected teams).
- Ticket drawer: "Collaborators" picker with Save, below the assignee; read-only list for others.
- Tickets list: "+N" badge next to the assignee, new "Collaborating" view, and collaborating tickets count in "My tickets & tasks".
- History/route timeline show collaborator added/removed.

## Tests
7 new unit tests (routing rules, visibility, history). The 7 suites that need installed dependencies were not runnable here.
