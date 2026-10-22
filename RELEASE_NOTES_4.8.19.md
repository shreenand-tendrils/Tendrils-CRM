# Tendrils Platform v4.8.19

## Changes
- Pasted screenshots now get an immediate preview in ticket/task descriptions and ticket/task comment composers; pasted images are stored as inline attachments and excluded from the regular Files lists.
- Create-ticket/task/project description paste flow previews screenshots before saving and relinks uploaded inline images after the record is created.
- Consolidated Documents, Reminders, and My Notes into one Resources destination with tabs. Existing URLs remain supported.
- Restored distinct Manager and Employee permissions. Managers can triage and assign across teams; Employees are team-scoped and can update work they own or are assigned to.
- Demo seed now includes Platform Admin, Managers, Employees, Client Admins, and Client Members. Facebook Ads and Google Ads are consolidated into a shared Advertising team; the seed migrates existing team links and assignments while deactivating legacy ad teams.
- Kept ticket deletion and the existing ticket history flow.

## Validation
- API JavaScript syntax checks passed.
- Full frontend build and automated API test suite could not be run in this environment because npm dependencies were not fully available from the package registry. Run `npm ci`, then `npm run check` in the project root before deployment.
