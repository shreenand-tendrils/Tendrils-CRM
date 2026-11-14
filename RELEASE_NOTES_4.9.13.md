# Tendrils CRM 4.9.13 (on top of 4.9.12)
## Clickable links everywhere
- New shared `Linkify`: any http(s):// or www. address becomes a clickable link (new tab) in descriptions, comments, task/ticket titles (windows, tables, boards), chat, notes, project updates, notifications and team descriptions. It is applied when text is shown, so every existing link in old data works too. Notification emails also turn links into real links.
## Emails to members of other teams
- Task created with other teams: those teams' members are now notified (email + in-app) even when someone is already assigned (before, only when no assignee).
- Teams added later to a ticket or a task (edit): members of the newly added teams are notified too. Already-assigned people are not double-emailed.
## Settings page redesign
- Hero header, side navigation (Account, Notifications, Access, Integrations, Security) that becomes tabs on mobile, grouped collapsible permissions, workspace/team overview, cleaner Official email form, and a Switch Employee/Client button.
No schema changes / migrations.
