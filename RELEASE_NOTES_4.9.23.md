# Tendrils CRM 4.9.23: UI consistency, dd/mm/yy dates, admin Reports

No database migration. No data is touched (the Reports API is read-only).

## Phase 1: Dates are dd/mm/yy everywhere
- One shared formatter (`apps/web/src/lib/dates.js`): date `13/11/26`, time `14:05` (24h), date+time `13/11/26, 14:05`.
- Replaced every `toLocaleString / toLocaleDateString / Mon d, yyyy` in tickets, tasks, comments, files, chat, notifications, reminders, notes, documents, activity, history, analytics, date-range picker and project updates.
- Emails (due date, invitation expiry) and WhatsApp replies use dd/mm/yy too.
- Due dates are shown by their calendar day, so they never slip a day in another timezone.
- The browser's own calendar box (`<input type="date">`) shows the date in the browser/OS language; the browser does not allow changing that. Everything the app prints itself is dd/mm/yy.

## Phase 2: UI inconsistencies fixed
- Three different `.seg` (segmented) styles merged into one; Admin console and People tabs now use it instead of the old underline tabs.
- Two stat-card designs (`.metric` and `.kpi`) merged: one shared `Kpi` card is used on Overview, Admin console and Reports.
- `.secondary` and `.btn-soft` buttons now share the same height, radius and hover.
- One `Loading` indicator replaces the plain "Loading…" text; empty states added where a table could show nothing.
- Admin workload table: wrong mobile label ("Request") fixed to "Person"; numbers right-aligned.
- All shared fixes live in `styles/consistency.css` (loaded last) so nothing else had to be rewritten.

## Phase 3: Reports (Platform admin only)
Sidebar: ADMIN > Reports (`/admin/reports`). API: `GET /api/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` (needs `admin.view`).
- **Overview**: opened, closed, close rate, avg days to close, Open / Review-Test / Review-Help counts, overdue, avg age of open tickets, unassigned, team-to-team tickets; opened vs closed per month; status and priority bars; highlights (team that opened most / closed most / fastest / most overdue, staff who opened / closed most); top-5 lists. Clicking a count opens the matching ticket list.
- **Team comparison**: every team side by side (opened, closed, close rate, open, review states, overdue, unassigned, High/Urgent open, avg days to close, avg open age, oldest open, raised by team, raised for other teams, received from other teams / clients, closed by team, shared with, tasks new / done / open / overdue). Sortable, best value highlighted, CSV export, click a team to see its tickets.
- **People**: who raised and who closed the most (staff and clients), assigned open / closed, overdue, tasks done / open.
- **Clients**: opened, closed, open now, overdue per client.
- **Ticket details**: full list with client, project, status + progress, priority, owner / shared / origin team, raised by, assignee, created, due, closed, closed by, days, tasks done/total, comments; search + filters (period, team, status, priority, client); 25 per page; CSV of everything that matches.

How numbers are counted: a ticket belongs to its owner team; "opened" = created in the period; "closed" = its latest move to Closed is in the period (closed by = who made that move; a client when the client approved). Same rules as the Overview analytics.

## Deploy (same as before)
```
scp Tendrils-CRM-v4_9_23-reports-ui-dates.zip ubuntu@<EC2>:/tmp/
# on the server
cd /tmp && rm -rf tendrils-new && mkdir tendrils-new && unzip -q Tendrils-CRM-v4_9_23-reports-ui-dates.zip -d tendrils-new
rsync -a --exclude node_modules --exclude uploads --exclude .env --exclude .git /tmp/tendrils-new/crm_fix/ ~/Tendrils-CRM/
cd ~/Tendrils-CRM && npm install && npm run build && npx prisma migrate status --schema apps/api/prisma/schema.prisma
# restart the API the way you normally do (pm2 restart ... / systemctl restart ...)
```
Test: sign in as Platform admin > ADMIN > Reports. Employees and clients do not see the link and get "no access" on the URL.
