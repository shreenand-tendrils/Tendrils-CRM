# Release 4.9.27 — ticket discussion, attachments, mentions and mobile routing

- Hardened ticket description uploads so the shared upload handler accepts either a selected `File` or a file-input event. Ticket-level files now refresh reliably after upload.
- Ticket-owned attachments are also listed beneath the ticket description. Pasted screenshots remain rendered inline in the description; the existing Comments & files > Files view is unchanged.
- Kept comment attachments linked to their comment, rendered beside the relevant comment, and included them in the existing Files tab.
- Added `@name` suggestions to ticket comments. Valid mentions receive an in-app notification and an email. People already receiving the normal comment notification (requester/creator, assignee, collaborators, prior commenters, or routed team recipients) are not sent a duplicate email. Mentions are restricted to people with ticket access; internal notes never notify client users.
- Reworked the ticket drawer's narrow-screen layout and the Route & history timeline controls/cards to prevent desktop-width clipping and improve touch navigation.
- No changes to ticket status, routing permissions, task workflow, or the existing Files tab behavior.
