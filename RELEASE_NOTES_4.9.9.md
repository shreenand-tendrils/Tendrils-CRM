# Tendrils CRM 4.9.9
- Ticket counter column is `lastNumber` (matches the live DB). Migration `20261116090000_ticket_counter_safe` is idempotent (CREATE TABLE IF NOT EXISTS), so it is a no-op where the table already exists. The old `20261115090000` migration is removed from the package.
- Tasks can be renamed after creation (Rename button in the task window, for people allowed to edit the task). Reassigning employees after creation stays available to task assigners.
- Notifications: Unread/All tabs, identical items merged (x3), 10 at a time with "Show more", "Clear read", and old read items auto-expire (read > 14 days, any > 60 days).
- Activity feeds: repeated identical events merged, shows 6-8 latest with "Show more".
