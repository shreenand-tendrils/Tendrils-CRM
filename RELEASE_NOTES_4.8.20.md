# Tendrils Platform v4.8.20

## Corrected role model
- Removed Manager as an assignable/runtime role from API RBAC and frontend role lists.
- Demo staff who previously held Manager are seeded as Employees.
- Migration converts existing Manager memberships/invitations to Employee and removes MANAGER from the PostgreSQL MemberRole enum.
- Platform Admin remains the only global administrative role; employees retain operational permissions subject to team/access checks.
- Facebook Ads and Google Ads remain consolidated into the common Advertising team.
- Screenshot paste previews, Resources tabs (Documents, Reminders, My Notes), ticket deletion, and ticket history changes from v4.8.19 are retained.

## Deployment note
Back up the database before deployment. Run `npm ci`, `npm run db:deploy`, `npm run db:generate`, then `SEED_FORCE=true npm run db:seed` to migrate/top up existing demo data, and finally `npm run check`. The full build/test suite must pass in the target environment before production rollout.
