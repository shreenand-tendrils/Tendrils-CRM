# Database

Prisma schema: `apps/api/prisma/schema.prisma`. It includes Auth.js adapter models plus organization/membership, teams, projects, tickets, tasks/subtasks, comments, attachment metadata, notifications and activity logs.

```powershell
npm run db:generate
npm run db:migrate -- --name add_module_name
npm run db:deploy
npm run db:seed
npm run db:studio
```
`migrate dev` generates and applies local migrations. Review SQL and commit it. Production should apply committed migrations using `migrate deploy`. Seed is idempotent for the Tendrils organization, four example client organizations and internal teams. It does not create a privileged user.

To bootstrap a first employee after first OAuth login, open Prisma Studio, find `User` by the verified email, find `Organization` with slug `tendrils`, then create a `Membership` with that user's ID, the Tendrils organization's ID, role `PLATFORM_ADMIN`, and `isActive=true`. Do this only for a trusted administrator. Then sign in again.


## Team-scoped work access (v4.6)

Tickets and tasks now use explicit team participation join tables. `Ticket.teamId` remains the owner team; `TicketTeamAccess` lists every team allowed to see the ticket. `Task.teamId` is the task owner team; `TaskTeamAccess` defines task/subtask visibility. See [`TEAM_SCOPED_WORK.md`](TEAM_SCOPED_WORK.md) for the migration and the access-control contract. Apply existing migrations with `npm run db:deploy`, then run `npm run db:generate`.
