# Tendrils CRM v4.9.1 — safe update for the live EC2 server

**No database change. No new migration. No seed. No new npm packages.** Existing tickets, tasks, files, users and chat are untouched.
The zip does NOT contain `apps/api/.env` — your server's own `.env` stays exactly as it is.

## Deploy on EC2 (nothing else needed)
1. Back up as usual (`pg_dump` + the `uploads/` folder).
2. Copy this release over the project folder (keep your `.env` and `uploads/`).
3. `npm install` (no new deps, safe) then `npm run build` (builds the web app).
4. Restart the API service the way you normally do.
5. **Never run** `db:seed`, `db:fresh` or `db:reset-demo` on production. (Seed is already blocked once marked, and the demo login is off when `NODE_ENV=production`.)

## What changed
1. **Safe for production** – only code changes; no data is created, changed or deleted.
2. **Mobile** – new `styles/mobile.css`: no sideways scroll, ticket/task windows, create forms, analytics cards and toasts fit the phone screen.
3. **Teams** – click a team card to see its member list (name, email, role). Admin buttons still work separately.
4. **Windows stay open** – create ticket/task/project forms, ticket & task windows and team dialogs no longer close when you click outside or press Esc. Close with ✕ / Cancel only.
5. **Attach files while creating** – new "Attach files" box in Create ticket / task / project / project request. Files upload right after saving and appear in the item's Files list (same as upload after creating). Limit 15 MB each; images, PDF, docs, ZIP, TXT, CSV. If one file fails, the item is still saved and you get a clear message.
6. **Analytics** – repeated cards removed from Overview. New "Everything I can see / Only mine" switch so every person (admin, employee, client) can see their own numbers. Clients now see plain status names (Open / Needs your review / We need info from you / Closed). Active projects is part of the same card grid.
7. **Refresh** – the Refresh button now reloads the workspace *and* analytics/client dashboard, spins while working and shows "Up to date" (or an error). Auto-refresh: workspace every 20 s, analytics about every minute, and instantly when you return to the tab.

## Status meaning (Review/Test vs Review/Help)
- **Open** – team is working (In Progress / QA).
- **Review/Test** – work is Resolved and waiting for the client/manager to review & approve.
- **Review/Help** – team is blocked and needs more info from the client or another team.
- **Closed** – approved and finished.

## Files touched
Web: `Window.jsx`, `EntityModal.jsx`, `TeamsPage.jsx`, `MembersPanel.jsx`, `ProjectUpdatesModal.jsx`, `ProjectsPage.jsx`, `WorkspaceShell.jsx`, `PageHeader.jsx`, `useWorkspace.js`, `AnalyticsPanel.jsx`, `ClientOverview.jsx`, `OverviewPage.jsx`, `main.jsx`, new `styles/mobile.css`.
API: `routes/dashboard.routes.js` (optional `?scope=mine`), `routes/files.routes.js` (also accepts CSV).
