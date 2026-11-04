# Tendrils CRM 4.9.8

- Sequential ticket numbers per organisation prefix (e.g. TEN-0001, TEN-0002). Permanent, unique, concurrency-safe (new `TicketCounter` table; migration `20261115090000_ticket_counter`). Existing ticket keys are NOT changed.
- My tickets: a ticket routed to a team with no individual assignee shows under My tickets for every member of that team.
- Tasks: employees also see tasks they co-own (multi-assignee), tasks of tickets they raised or hold, and subtasks of their tasks (team/role rules unchanged).
- Tickets page opens on "My tickets & tasks" for employees; All/Unrouted/Overdue still available. Clients still open on All.
- Clearer notification and assignment emails (subject prefix [Tendrils], who did what, ticket key, priority, next step, open link).
- Includes 4.9.7 (team-to-team review flow, due-date rules).

Deploy: `npm install`, `npx prisma migrate deploy` (one new additive migration), `npm run build`, restart.
