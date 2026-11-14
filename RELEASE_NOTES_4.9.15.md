# Tendrils CRM 4.9.15
## Send-back / review emails now reach the team, not only admins
- Cause: when a ticket was sent back or approved, the mail went to the ticket's assignee only; if nobody was assigned at that moment (team-routed ticket, or the assignee was cleared) it went to admins only, so the team's people got nothing.
- Now the recipients are: the assignee, the previous assignee, everyone holding a task on the ticket, and - when nobody is assigned - every member of the ticket's team(s) plus admins.
- Same fallback for task approve / "client asked for changes": if no one is assigned, the task's / ticket's team members and admins are notified.
No schema changes / migrations.
