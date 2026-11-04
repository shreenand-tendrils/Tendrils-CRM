# Tendrils CRM 4.9.11
## Same email as Employee and Client
- If one email has both an internal (employee) membership and a client membership, a chooser appears after sign-in: Continue as Employee / Continue as Client. The choice is asked again after every sign-out and can be switched from the sidebar ("Switch to Client/Employee").
- The chosen side limits that request to those memberships only (role, permissions, tickets visible). Emails with only one side are not asked anything. Frontend sends `x-tendrils-mode`; API filters memberships in `services/session.js`.
## Comment emails
- Ticket comments now notify the assignee, the requester, and earlier participants (and the team's managers / admins when nobody is assigned), by in-app + email. Internal notes go to employees only, never clients. Previously only a client-visible comment from staff reached the client, and the assignee was skipped.
- Task comments now send emails too (they were in-app only) and include earlier commenters.
- Email subjects/bodies name the ticket key + title and who wrote what.
No schema changes / migrations.
