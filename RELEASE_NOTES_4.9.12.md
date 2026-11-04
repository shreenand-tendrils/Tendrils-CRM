# Tendrils CRM 4.9.12
## Official email on profile
- New optional `User.workEmail` (migration `20261120090000_user_work_email`). Set it in Settings > Official email.
- All notification emails (assignments, comments, mentions, daily updates, reminders) go to the official email when set, else the login email. Invitation / access-granted emails still go to the login address.
