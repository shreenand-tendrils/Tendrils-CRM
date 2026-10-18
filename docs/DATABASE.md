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
