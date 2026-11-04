# Tendrils CRM 4.9.6

## Client ticket privacy
- Client users now see only client-visible tickets they personally created, regardless of whether they have the CLIENT_ADMIN role.
- Applied the requester-only rule to ticket list scope, direct ticket access/edit checks, client overview counts, and ticket activity visibility.

## Due-date validation
- Ticket, task, project, and project-request due dates now reject dates before the current UTC calendar day at the API boundary.
- Date inputs for due dates use today's date as their minimum in the create modal.
- Existing historical due dates are not automatically rewritten; they remain visible until changed.

## Deployment
- No database schema changes or migrations required.
- Preserve the existing `.env`, uploads, and database during deployment.
