# Tendrils CRM 4.8.22

## Ticket routing and team workflows
- Client-created tickets require a selected client-visible team and enter that team as OPEN and unassigned.
- Team employees can route visible team tickets to another team, with assignee options constrained to the selected owner/shared teams.
- Destination team employees are notified when work is routed across teams.
- Facebook Ads and Google Ads are represented by the shared Advertising team in seed data.

## Data and UI
- Added a versioned seed marker so this release's demo seed can be run deliberately.
- Added `npm run db:reset-demo` as an explicit destructive clean-database reset-and-seed workflow (backs up any data first).
- Documents, Reminders and My notes remain grouped in the Resources page.
- Fixed a duplicate closing select tag in the ticket routing UI.

## Important
`db:reset-demo` deletes existing database records. Back up the database before using it. The seed is demo-only.
