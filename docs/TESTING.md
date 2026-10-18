# Testing the platform as admin, team member and client

## 1. One-time setup (PowerShell, project root)
```powershell
# apps\api\.env  -> add:  DEV_LOGIN="true"      (local testing only; ignored when NODE_ENV=production)
npm install
npm run db:generate
npm run db:deploy
npm run db:seed
npm run seed:demo        # creates demo users, projects, tasks, tickets
npm run dev
```
Open http://localhost:5173. The sign-in page now shows **DEV LOGIN** buttons, and the sidebar has a
**DEV · view as** switcher so you can jump between people without signing out.

| Demo user | Role | What to look at |
|---|---|---|
| maya.demo@tendrils.io | Manager | Admin console, project teams, sees every chat room |
| tara.demo@tendrils.io | Team lead | Staff view |
| dev.demo@tendrils.io | Employee | Tasks, chat, daily update |
| isha.demo@tendrils.io | Employee | Second person for DMs / multi-assignee |
| sofabed.demo@sofabed.test | Client (Sofabed) | Tickets & projects only |
| jennihome.demo@jennihome.test | Client (JenniHome) | Proves clients can't see each other |
| root.demo@tendrils.io | Platform admin | Only role that can grant/remove Platform admin |
| boss.demo@sofabed.test | Client admin (Sofabed) | Sees ALL Sofabed tickets (the client member only sees their own) |

Your real Google admin account keeps working: choose **My Google account** in the switcher.

## 2. Automated check (API must be running)
```powershell
npm run smoke      # ~75 checks: roles, client isolation, chat, DMs, WebSocket security, updates, dates
npm run test       # unit tests
```

## 3. Manual walkthrough (use two browser windows: normal + private)
**Chat & DMs** — Window 1 as *Dev*, Window 2 as *Isha* → Chat → General: messages appear instantly, typing indicator shows,
unread badge appears on the other side and clears when opened. "+" next to Direct messages → private chat. Green dot = online.
Maya sees every project room; Dev only sees projects he is a member of.

**Notifications** — As Maya create a task and tick Dev + Isha as assignees → both get a live toast and a notification.

**Daily update** — As Dev: Daily update → post. As Maya: Admin console shows it; people with no update are listed under *Waiting on*.
(Email is sent if SMTP_* is configured in `.env`; otherwise only in-app.)

**Client view** — As Sofabed client: no Tasks/Chat/Daily update/Teams in the menu; only Sofabed's tickets and projects;
the INTERNAL ticket (SOF-100002) is invisible; JenniHome data is invisible.

## 3b. New in this version
**Ticket → task** — As Maya open any ticket → set *Assignee* to Dev. Dev instantly gets a toast, and Tasks shows
`[KEY] title` with a "From KEY" chip. Reassign → the task moves. Move the task to *Done* → the ticket becomes *Resolved*.
Close the ticket → the task completes. Existing assigned tickets: run `npm run backfill:tasks` once.

**RBAC** — Admin console → *People & access* (add/deactivate people, change roles) and *Roles* (the exact permission table).
Try: Dev (employee) can only move his own tasks and has no "New project"; Tara (team lead) can assign and triage;
Maya (manager) manages people but cannot create Platform admins; Root can; nobody can edit their own access.

**Layout** — the sidebar scrolls with the page (not sticky). The « button collapses it; on phones it is a drawer.
To pin it again add `position:sticky;top:0;height:100vh;overflow:auto` to `.sidebar` in `styles/app.css`.

## 4. Production
Leave `DEV_LOGIN` unset/false. The `/dev/*` routes are not even mounted then, and demo logins are rejected.
Run the API behind HTTPS so the WebSocket uses `wss://`; if the web app is on another origin, set `WEB_ORIGIN` accordingly.
