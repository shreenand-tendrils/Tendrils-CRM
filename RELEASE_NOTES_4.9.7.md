# Tendrils CRM 4.9.7

## Fixes
- Employee-to-employee tickets (internal workspace) can now be closed by the employees working on them. Previously every non-admin employee was blocked from "Closed", and the status dropdown hid it. Client-raised tickets still need client review (unchanged).
- Due date can't be set to a past date (create + edit, tickets and tasks). Re-saving an item whose existing due date is already overdue no longer fails, so closing / editing old tickets and tasks works. Edit form no longer blocks submit on an old saved date.

## Deployment
- No schema changes or migrations. Keep existing `.env`, uploads and database.

## Team-to-team review flow (replaces the earlier "any employee can close")
- Ticket raised by an employee: the team/assignee submits it (Review/Test); the person who raised it gets the same "Ready for your review" card as a client, with Approve (closes) or Send back (reopens), and is notified.
- Only the requester (or an admin/triager) can set Closed on these tickets. If the requester is also the assignee they can close directly.
- Client tickets are unchanged.
