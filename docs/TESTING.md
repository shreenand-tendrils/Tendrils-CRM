# Tendrils Platform: Complete Testing Guide (v4.8.3)

Covers the full company structure: **Boss → Team Managers → Team Employees → Clients**.
Work phase by phase. Do not skip Phase 1.

---

## Phase 0: What you need
- Node 22.12+, a local PostgreSQL (or `docker compose up -d`), PowerShell.
- `apps/api/.env` (copy from `.env.example`) containing:
  ```
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tendrils_crm?schema=public"
  NODE_ENV="development"
  DEV_LOGIN="true"
  ```
- **Safety rule:** `DATABASE_URL` must point to your LOCAL database. Before every seed run, check that no production URL is set in the terminal:
  ```powershell
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  ```

## Phase 1: One-time setup (project root)
```powershell
npm install
npm run db:generate
npm run db:deploy          # applies all migrations
npm run db:seed            # ONE clean seed: company, 4 clients, projects, routed tickets with history
npm run dev                # API :4000, web :5173
```
Expected: API log shows `[dev] DEV_LOGIN is ON`. Open http://localhost:5173.
`db:seed` is ONE-TIME: the first run seeds everything, every later run prints "Seed skipped" and changes nothing, so your test edits (roles, teams, deactivated people) are never overwritten. To top up missing rows only: `SEED_FORCE=true npm run db:seed`. For a completely clean start (wipes ALL data in the local database, re-applies migrations, re-seeds):
```powershell
npm run db:fresh
```
The old demo accounts (maya, tara, dev, isha, root) no longer exist. If they are still in your database, `db:seed` switches them off; `db:fresh` removes them completely.

## Phase 2: Logging in as each person
Sign-in page shows **DEV LOGIN** buttons; inside the app the sidebar has a **DEV · view as** switcher.
If someone is missing from the list, their email is not `name.demo@domain`, or the seed was not run.

### Staff (from `npm run db:seed`)
| Person | Email | Role | Team(s) |
|---|---|---|---|
| Arjun Mehta (the Boss) | arjun.demo@tendrils.io | Platform admin | Management / Operations |
| Rahul Verma | rahul.demo@tendrils.io | Manager | Development |
| Nisha Rao | nisha.demo@tendrils.io | Manager | Graphics / Creative |
| Kavya Nair | kavya.demo@tendrils.io | Manager | SEO / Marketing |
| Vikram Singh | vikram.demo@tendrils.io | Manager | QA |
| Anil Kumar | anil.demo@tendrils.io | Manager | IT / Infrastructure |
| Priya Shah | priya.demo@tendrils.io | Manager | Product + Management / Operations |
| Sneha Kulkarni | sneha.demo@tendrils.io | Employee | Development |
| Aditya Joshi | aditya.demo@tendrils.io | Employee | Development + QA |
| Karan Patil | karan.demo@tendrils.io | Employee | Graphics / Creative |
| Meera Iyer | meera.demo@tendrils.io | Employee | SEO / Marketing |
| Pooja Desai | pooja.demo@tendrils.io | Employee | QA |
| Nikhil Gupta | nikhil.demo@tendrils.io | Employee | IT / Infrastructure |
| Ritu Sen | ritu.demo@tendrils.io | Employee | Product |

### Clients (from `npm run db:seed`)
| Person | Email | Role | Company |
|---|---|---|---|
| Rohan Malhotra | boss.demo@sofabed.test | Client admin (client boss) | Sofabed |
| Neha Arora | sofabed.demo@sofabed.test | Client member | Sofabed |
| Sanjay Bhatia | boss.demo@jennihome.test | Client admin (client boss) | JenniHome |
| Tanvi Kapoor | jennihome.demo@jennihome.test | Client member | JenniHome |
| Divya Menon | boss.demo@jennifer-furniture.test | Client admin (client boss) | Jennifer Furniture |
| Imran Qureshi | boss.demo@comfort-furniture.test | Client admin (client boss) | Comfort Furniture |

### Seeded data you will see
- **Projects:** Website Revamp (Sofabed, lead Rahul), JenniHome SEO (lead Kavya), Catalog Migration (Jennifer Furniture, lead Anil), Brand Refresh (Comfort Furniture, lead Nisha).
- **Tickets:** SOF-100001 blurry banner (Creative, assigned Karan, in progress), SOF-100002 internal schema refactor (Development + QA), SOF-100003 invoice export (**unrouted**, waiting for a manager), SOF-100004 footer links (in *Client review*), JEN-100001 size chart (SEO, shared with Development), JFN-100001 missing prices (IT), COM-100001 logo colours (**unrouted**). Routed tickets already have a History and an auto-created task.
- **Tasks:** every task has a team and its assignees come from that team (one multi-assignee task, one overdue task).

## Phase 3: Role tests
Use two windows (normal + private) when two people are involved.

**3.1 Boss (arjun.demo)**
1. Admin console opens. People & access lists everyone; Roles shows the permission table.
2. Can grant Platform admin (only role that can). Cannot edit own access.
3. Sees every ticket, project, chat room.

**3.2 Manager (rahul.demo)**
1. Admin console opens, can invite/change roles, cannot grant Platform admin.
2. Can create projects, assign tasks, triage tickets.
3. Cannot create teams or client workspaces unless the permission table says so (check Roles).

**3.3 Employee (sneha.demo)**
1. No "New project"; no admin console.
2. Can create tasks, raise tickets, post a daily update, use chat.
3. Can edit only tasks they created or are assigned to.

**3.4 Client (sofabed.demo, boss.demo@sofabed.test)**
1. Menu has no Tasks / Chat / Daily update / Teams.
2. Member sees only tickets they raised; Client admin sees all Sofabed tickets.
3. INTERNAL tickets and JenniHome data are invisible.
4. Client can only approve or send back a ticket that is in *Client review*.

## Phase 4: Team-first ticket flow (the main end-to-end test)
Rule: **pick the team first, then the assignee from that team.** The Assignee dropdown is disabled until a team is chosen and only lists that team's members (shown as `Name — Role`).

In the DEV switcher every person is shown as `Name — Role · Team(s)` (e.g. `Rahul Verma (Dev Manager) — Manager · Development`), so you always know who you are testing as.

**4.1 Client raises a ticket**
1. Log in as **boss.demo@sofabed.test** (Client admin) or **sofabed.demo@sofabed.test** (Client member) → *New ticket*. There is no team/assignee field for clients.
2. Ticket appears with status *Received*. Client sees no Team column and no assignee dropdown.

**4.2 Manager routes it (team first)**
1. Log in as **Rahul** (Manager, Development). The new ticket is in his list as **Not routed**. **Sneha** (employee) must NOT see it.
2. Open the ticket. The *Assignee* dropdown is disabled and says *Select a team first*.
3. Choose **Team = Development**. The Assignee dropdown now lists only Development people (Rahul, Sneha, Aditya) with role labels. Meera/Pooja/Karan are not there.
4. Assign **Sneha** → Sneha gets a notification and a task `[KEY] title`. Table now shows *Development* in the Team column.
5. API check: sending an assignee from another team (e.g. Meera) returns 400 `ASSIGNEE_NOT_IN_TEAM`; sending an assignee with no team returns 409 `TICKET_NOT_ROUTED`.

**4.3 Re-routing never makes the ticket vanish**
1. Still as Rahul, change **Team = QA**. Sneha is not in QA, so the assignee is cleared automatically and a toast explains it.
2. Rahul **still sees the ticket** (he routed it). Sneha no longer sees it. **Vikram** (QA manager) and **Arjun** (boss) see it.
3. As Vikram, the Assignee dropdown lists QA members (Vikram, Pooja, Aditya). Assign **Pooja** → she sees the ticket and gets a task.
4. **Aditya** (Dev + QA) appears under both teams.
5. Add **Development** under *Also share with other teams* → Dev members see it too; owner team stays QA.

**4.4 Employee**
1. As **Pooja**: can change status/comment only. Team, assignee and priority are read-only. Moving the task to *Done* resolves the ticket (and *Client review* if the manager sets it).
2. As **Meera** (SEO): must NOT see the ticket (direct URL returns "not found").

**4.5 Client closes the loop**
1. Manager sets status **Client review** → client sees *Waiting for your review* with **Approve** / **Send back**.
2. Approve → ticket Closed, task Done.

**4.6 Boss (root admin)**
1. Sees every ticket regardless of team, can route to any team, and can unassign.

## Phase 4a: Team picker UI (ticket drawer, create ticket, create task)
Same flow everywhere: **team at the top → Save team access → people only from those teams.**
1. As **Rahul**, open an unrouted ticket. At the top of the drawer you get: **Team** dropdown, **Also share with other teams** (dropdown with checkboxes), a **Save team access** button, then **Assignee**.
2. Pick a team and shared teams. The button enables. The Assignee dropdown stays disabled and says *Click “Save team access” first* until you save.
3. Click **Save team access**. Assignee now lists, grouped, the people of the owner team (and the shared teams), each as `Name — Role`.
4. Change the owner team and save again: an assignee who is not in the new teams is cleared automatically (toast).
5. *Create a ticket* and *Create a task* (Tasks page): choose **Team** first, then optionally **Also share with other teams**; the Assignee(s) list is disabled until a team is chosen and only offers members of the chosen team(s). A task assigned to someone outside the task's teams returns 400 `ASSIGNEE_NOT_IN_TEAM`; with no team, 409 `TASK_NOT_ROUTED`.
6. Moving a task to another team removes assignees who are not in it.

## Phase 4b: Ticket history and filters
**History tab** (ticket drawer → *History*, next to *Comments*). It is a per-ticket timeline, separate from the Admin activity log.
1. Open the ticket from Phase 4 as **Rahul**. History reads like: `Client created this ticket`, `Rahul Verma (Manager) routed the ticket to Development`, `... assigned the ticket to Sneha Kulkarni`, `... moved the ticket from Development to QA`, `... unassigned Sneha Kulkarni` (with the note *Cleared automatically: not a member of the new team*), `Vikram Singh (Manager) assigned the ticket to Pooja Desai`. Every line shows the person's role and the time, grouped by day.
2. Change status, priority, due date and title; upload a file; add a comment and an internal note. Each shows up as its own line (internal notes say *added an internal note*).
3. Move the linked task to *In progress*: the ticket history shows the status change with *Moved by task progress*.
4. Log in as **the client** and open the same ticket → History shows only: created, status changes (in client wording like *In progress*, *Waiting for your review*), client-visible comments, attachments, title/due-date/priority changes. It must NOT show teams, assignees or internal notes.
5. **Meera** (SEO) cannot open the history (not found).

**Ticket filters** (Tickets page): quick views *All*, *My tickets*, *Unrouted* (managers/boss), *Overdue*, plus Status, Priority and Team dropdowns. Clients see only All/Overdue, Status and Priority. Combine them with the search bar.

## Phase 4c: My notes (private)
Sidebar → **My notes** (team members only).
1. As **Sneha**: write a note (optional title, date defaults to today) → *Save note*. It appears under *My notes*. Edit it, search for a word from it, delete it.
2. As **Rahul** and **Arjun**: *My notes* shows only their own notes. Sneha's note is nowhere (not in Admin console, not in Activity log).
3. Check Arjun's *Notifications* and email: nothing is sent when Sneha saves a note.
4. As a **client**: there is no *My notes* menu; calling the API returns 403.

## Phase 5: Feature checks
- **Chat & DMs:** Sneha and Aditya in General; messages appear instantly, typing indicator, unread badge. Managers see all project rooms; employees only their projects.
- **Notifications:** create a task with two assignees; both get a live toast.
- **Daily update:** Sneha posts one; Boss admin overview shows it and lists people who have not posted.
- **Invitations:** Admin → invite a new email as Employee with teams; check the Invitations tab. Email is sent only if `SMTP_*` is set.
- **Deactivate:** deactivate Nikhil; he can no longer sign in. Reactivate.

## Phase 6: Automated checks (API running, `npm run db:seed` done)
```powershell
npm run test      # unit tests
npm run smoke     # end-to-end checks incl. the team-first ticket flow (needs `npm run db:seed`)
npm run check     # prisma validate + tests + web build
```

## Phase 7: Production (Render)
1. Build: `npm ci && npm run db:generate`. Start: `npm run db:deploy && npm run start --workspace apps/api`.
2. Dev login is OFF in production by design (`NODE_ENV=production`). Never set `DEV_LOGIN=true` there.
3. Add real people via Admin → Invite (real Google emails), not with seed scripts.
4. First admin: set `ADMIN_EMAIL`, then run `npm run link-admin` once.
5. **If deploy fails with Prisma P3009** (a migration is marked failed):
   ```powershell
   cd apps\api
   $env:DATABASE_URL="<production external URL>?sslmode=require"
   npx prisma migrate resolve --rolled-back <migration_name>
   npx prisma migrate deploy
   Remove-Item Env:DATABASE_URL
   ```
   Never edit a migration that already failed in production; fix with `resolve` or add a new migration.
6. After any leak of the DB password, reset it in Render and update `DATABASE_URL`.

## Phase 8: Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Dropdown empty | `DEV_LOGIN` not "true", or `NODE_ENV=production`, or seeds not run. Restart API after editing `.env`. |
| Person missing in dropdown | Email is not `name.demo@domain`. |
| `does not provide an export named …` at API start | Re-export missing in `services/index.js`. Fixed for `assertTaskSubtasksDone`. |
| Users seeded but not visible in the app | Seed ran on a different database than the app uses. Check `DATABASE_URL`. |
| `P1001 can't reach database` | Network/firewall or Render IP rules. Retry, or run the command from Render's start command. |
| `Could not find Prisma Schema` | Run from `apps\api`, or add `--schema apps/api/prisma/schema.prisma` at repo root. |
| Employee sees no tickets | Ticket not routed to their team (Phase 4). |
| Assignee dropdown disabled | No team chosen yet. Pick the team first (by design). |
| Assignee list is empty | The chosen team has no members. Add people under Admin → Teams. |
| `ASSIGNEE_NOT_IN_TEAM` (400) | The assignee is not in the ticket's owner/participating teams. |


## v4.8.9 checks
1. **Ticket click**: Tickets > click any row. The drawer opens with its Comments tab listing the comments (try SOF-100001). No blank page.
2. **One-time seed**: run `npm run db:seed` twice. Second run says "Seed skipped". Change a role in Admin, re-run: it stays changed.
3. **Attachments**: in a ticket drawer upload a file; it appears in the list under Attachments, and the download button saves it.
4. **Flag & remind** (staff): in the drawer press Flag, set a reminder 2 minutes ahead; the Reminders page lists both and a notification arrives when it is due.
5. **Due alerts**: assignees get a "due soon" / "overdue" notification once a day per ticket (SOF-100004 is due tomorrow; JFN-100001 due in 2 days).
6. Run `npm run db:deploy` first: this version adds one migration (Reminder, SeedMarker).


## v4.8.10 checks (run `npm run db:fresh` first so the new seed data exists)
1. Sign in as `sneha.demo@tendrils.io` (employee, Development). Open **SOF-100004**: the Route tab shows the ticket, teams, assignee and the QA task with its subtask.
2. Click the QA task: the task drawer opens with the route and "You are here". Click the ticket node to jump back.
3. As Sneha press **Add linked task** on a ticket, choose team **QA**, and pick someone from QA. Saved without a permission error; the ticket history shows "added linked task".
4. As Sneha create a **ticket** for another team (Graphics). It stays in her list; sign in as `nisha.demo@tendrils.io` (Graphics manager): a notification says it was sent to her team.
5. As Sneha try editing someone else's ticket status in another team: still blocked (no triage).
6. As `karan.demo@tendrils.io` (Graphics): cannot see SOF-100004 or its QA task.
7. Tasks page: click a card or list row to open the task drawer; changing the status dropdown inside a card does not open the drawer.


## v4.8.11 checks: task comments and files
1. Tasks page: open the QA task (or any card). The drawer opens on **Comments**; seeded comments are there (after `npm run db:fresh`).
2. Type a comment and press **Ctrl+Enter** (or Cmd+Enter): it posts, the count in the tab and on the board card goes up, and the other assignees get an in-app notification.
3. Paste a screenshot into the comment box: it is attached and shows under **Files**; download it from there.
4. Delete your own comment (bin icon). You cannot delete someone else's comment unless you can edit any task (managers and admins).
5. Sign in as a client: no Tasks page, and `/api/v1/tasks/<id>/comments` returns 404. A team outside the task's teams also gets 404.

## v4.8.12 checks: floating windows
1. Tickets page: click a ticket. A centered floating window opens (not a side drawer): left = title, description, tabs (Route / Comments / History / Files); right = team, assignee, status, priority, reminders and linked tasks.
2. Click outside the window or press Esc to close. Click "Add linked task": the create form opens on top of the ticket window.
3. Open a task from the Route tab or the Tasks page: a task window opens with Comments / Route / Files and its details on the right. Click the ticket node to jump back.
4. Resize the browser below ~860px: the window becomes a full-height sheet and the right panel moves under the main area.


## v4.8.13 checks: client team choice, project requests, team admin
Run `npm run db:deploy` (one new migration) and `npm run db:fresh` for the new seed data.
1. **Client picks a team.** Sign in as a client (e.g. `boss.demo@sofabed.test`), New ticket, tick **Development** under "Which team(s) should handle this?". Sign in as `rahul.demo@tendrils.io` (Development manager): a notification says the ticket was raised, and it is in his list already routed to Development. Another team's manager (Graphics) does not see it.
2. **No team chosen.** Raise a ticket without ticking any team: every manager is notified and it shows as unrouted, like before.
3. **Client project request.** As the client, Projects > **Request project**, choose Development and QA. The project appears as "Planning · Requested by client" with both team chips; managers of those teams are added as members and notified. A seeded example "Sofabed mobile app (requested)" exists.
4. **Staff projects** can also carry teams (create form, or the Team button on a project card).
5. **Team admin (Platform admin only).** Sign in as `arjun.demo@tendrils.io`, Teams page: New team, Edit (rename, hide from clients), Members (tick staff, save), remove. A team with work history is archived (shown faded, Restore button); an unused team is deleted. Archived teams disappear from every dropdown.
6. **Managers cannot change teams.** As `rahul.demo@tendrils.io` the Teams page is read-only, and the admin console no longer offers team pickers (API returns 403).
7. Hidden team: "Management and Operations" is not offered to clients (admin can toggle it in Edit).

## v4.8.14 checks: project members follow the team
1. Projects > New project: pick **Teams working on it** first. The **Members** list then shows only people from those teams (before picking a team it asks you to choose one).
2. Projects > a project's **Team** button: tick/untick teams; the member list narrows to those teams, people already on the project stay listed.
3. API: adding a member who is not in the project's teams returns 400 `MEMBER_NOT_IN_TEAM`.

## v4.8.15 checks: manager review before finishing, and pasting images into descriptions
**Manager review rule** (tickets raised by a client or a manager)
1. As the assigned employee (`sneha.demo@tendrils.io`) open a client ticket (e.g. SOF-100001): in the status list **Resolved, Closed and Client review are greyed "(manager only)"**; In progress, Blocked and Review work. The API answers 403 `NEEDS_MANAGER_REVIEW` if you try anyway.
2. On the Tasks board, the **Done** option of that ticket's auto task is greyed for the employee. Moving it to Review notifies the team's managers ("ready for your review") and moves the ticket to Review.
3. As the manager (`rahul.demo@tendrils.io`) you can send it to Client review, resolve or close it. The client's Approve / Send back still works.
4. **Employee-made tickets** (team-to-team): when Sneha raises a ticket for another team, the assignee and Sneha can resolve or close it themselves (no manager gate).

**Paste images into descriptions**
5. New ticket / New task: click the **Description** box and press Ctrl+V with a screenshot on the clipboard. A marker line `[Pasted image: ...]` is inserted, the file shows as a chip (x to remove), and it is attached to the ticket/task when you save (see the Files tab).
6. Ticket window > Edit: paste into the description: uploaded straight away and marked in the text. Task window: **Edit** next to the description works the same way.
7. In a Files tab, the eye icon opens an image or PDF in a new tab; the download icon saves it.
(Project descriptions do not take pasted images: files can only be attached to tickets and tasks.)

## v4.8.16 checks: delete ticket, project paste, Teams page
Run `npm run db:deploy` first (adds `Attachment.projectId`).
1. **Delete ticket (manager/admin):** open any ticket window, press **Delete ticket** (red, in the right panel), confirm. Ticket, comments, files and history are removed; its mirror task goes with it; manual linked tasks are kept as standalone tasks (the toast says how many). The assignee is notified.
2. **Delete your own mistake:** as a client or employee raise a ticket, open it right away: **Delete ticket** is shown while it is Open, unassigned and has no replies from others. Once it is assigned, in progress or answered, the button disappears (API: 403 `TICKET_NOT_DELETABLE`); ask a manager.
3. **Project description paste:** New project / Request project: click Description, Ctrl+V a screenshot; chip appears, saved with the project. On the Projects page each card has **Files (n)**: upload, paste (Ctrl+V inside the window), view (eye icon) or download.
4. **Teams page** now uses the standard team cards again: all roles see the cards; the Platform admin also sees New team, Members, Edit and Remove.

## v4.8.18 checks: employees only, new statuses, analytics, inline images
Run `npm run db:deploy` (one migration: managers become employees, new ticket statuses/progress, closed/completed dates, inline images) and `npm run db:fresh` for the new seed (7 teams: IT, SEO, Graphics, Products, Marketing, Facebook Ads, Google Ads).
1. **No Manager role.** Roles are Platform admin (boss), Employee, Client admin, Client member. Sign in as any employee (e.g. `rahul.demo@tendrils.io`): they can route, assign, share across teams, create projects, delete tickets and reassign tasks inside their teams. Only the Platform admin (`arjun.demo@tendrils.io`) manages teams and their members.
2. **Client picks a team.** As a client (`boss.demo@sofabed.test`) raise a ticket choosing e.g. Graphics: every Graphics employee is notified and sees it; no team chosen means the Platform admin is notified.
3. **Statuses.** Ticket window: Status = Open / Review/Test / Review/Help / Closed, and a Progress list that follows it (Open: Not started, In Progress, QA; Review/Help: Need more Info; Review/Test: Resolved). Tickets page defaults to the **Open** filter and shows Created, Due and Days (days open, or days it took when closed).
4. **Client flow.** Review/Test shows Approve / Send back; Review/Help shows "I have replied, continue". The client ticket window has a **Tasks** tab with every task behind the ticket (status, people, opened, due, days), read-only.
5. **Overview.** Four status cards (click opens that list), plus analytics with From/To dates and presets: opened, closed, average days to close, average days open, overdue, tasks stats (staff) and a per-month opened/closed chart. Clients see their own tickets only.
6. **Sidebar:** Tickets is the second link for everyone.
7. **Pasted images** (ticket/task/project descriptions and comments): Ctrl+V shows the picture inside the text, it is not in Files. The image has a delete (x): it removes only the file; the ticket, history and status are untouched (and no history entry is written when pasting). Files in the Files tab can also be deleted by whoever added them or any employee.
8. **Reassign a task:** task window > Reassign (team, shared teams, assignees from those teams) > Save. Auto tasks follow their ticket.
(Old test scripts under apps/api/scripts, such as smoke.mjs, still describe the previous Manager-based flow.)
