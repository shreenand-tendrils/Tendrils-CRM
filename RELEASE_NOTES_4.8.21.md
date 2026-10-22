# Tendrils Platform v4.8.21

- Fixes the PostgreSQL enum migration failure when the deployed `MemberRole` enum already excludes `MANAGER`.
- Legacy-role detection now compares `role::text` to `MANAGER`, avoiding an invalid enum literal cast; existing legacy values are converted to `EMPLOYEE` where present.
- Retains the v4.8.20 feature set.

## Deployment recovery

If migration `20261101090000_employees_only_new_statuses` is marked failed in Prisma on the target database, back up the database, deploy this corrected migration file, then run `npx prisma migrate resolve --rolled-back 20261101090000_employees_only_new_statuses` from the API workspace context and rerun `npm run db:deploy`. Do not mark it applied unless you have independently verified all statements in that migration were applied.
