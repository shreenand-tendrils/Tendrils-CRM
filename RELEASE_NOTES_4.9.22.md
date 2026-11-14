# Tendrils CRM 4.9.22: comments + files together, route + history together, side panel
## Database (run before the new API)
- Migration `20261122090000_comment_attachments`: adds `Attachment.commentId` (nullable, indexed, cascades with the comment). Existing data is untouched.
- `npm --workspace apps/api run db:deploy` then `db:generate`.
## Comments & files (tickets and tasks)
- One tab, "Comments & files". A Files box on top lists the record's own files and, in a separate group, "Shared in comments" (who sent it, when). Each comment also shows its own files under the text.
- Files sent with a comment are linked to that comment on the server, so they never mix with the ticket's or task's own files (those lists exclude them, and counts stay correct).
- Composer: type, paste screenshots, paste a PDF, click Attach (multiple files), or drag and drop. Files upload straight away as drafts, can be removed with a cross before sending, and a comment can be files only.
- Files in an internal note are never downloadable by clients. Deleting a task comment deletes its files too.
- Same composer for ticket comments and task comments.
## Route & history
- Employees get one "Route & history" tab: the route tree on top (no duplicated events), the full history below with filters (All / Routing / Status & details / Comments & files). Clients keep a plain History tab.
## Side panel (ticket and task windows)
- Grouped sections: Status, Team & routing, People, Tasks; Reassign (task) is collapsible; Delete is a quiet button at the bottom.
- Flag & remind is one slim bar (Remind me opens the date picker). The Tasks card is smaller. "Opened"/"Client" duplicates removed from the task window.
## Tests
New unit test for the pasted-image marker parser. The 7 suites that need installed dependencies could not run here.
