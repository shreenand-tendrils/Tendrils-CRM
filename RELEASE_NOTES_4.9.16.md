# Tendrils CRM 4.9.16
## Team emails when a team is chosen on a ticket / task
- Ticket create (employee): every selected team now gets the email - your own team as well as other teams (before, own team members were skipped and only other teams were notified). The assignee still gets their own assignment mail and is not double-emailed; the creator is never emailed.
- Task create: same - own and other selected teams are all notified (even when someone is assigned).
- Hardening: if the in-app/WhatsApp step failed for one person, the loop stopped and the remaining people got no email. Each person is now handled independently.
No schema changes / migrations.
