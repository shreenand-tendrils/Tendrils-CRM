# Members, invitations, client portal & chat (v4.1)

## Sign-in model
* Google only. **Any email** can sign in if Google reports it as *verified* AND it is (a) an active member, or (b) holds an unexpired, un-revoked invitation.
* Invitation is accepted automatically at first sign-in (membership + teams created in one transaction). No token in the link: the Google-verified email *is* the credential.
* Access is re-checked on every API call and WebSocket action: deactivating a member takes effect immediately.
* Member type comes from the workspace: **internal** (Tendrils org: Platform admin, Manager, Employee) or **client** (client org: Client admin, Client member).

## Adding people (Admin console > People & access)
| Way | Endpoint | Result |
|---|---|---|
| Email invitation | `POST /admin/invitations` | Email sent; access starts when they sign in with that Google email. Valid `INVITE_EXPIRY_DAYS` (7). Resend (60s cooldown) / revoke. |
| Add directly | `POST /admin/members` | Membership exists at once; optional "you now have access" email. |
| Teams | `PUT /admin/members/:id/teams`, `PUT /teams/:id/members` | Many teams per member (internal only). |

Rules (server-side): role must fit workspace type; only Platform admin grants Platform admin; nobody edits their own access; at least one active Platform admin must remain; teams only for internal members.

## Client onboarding
1. Clients page > **New client** (workspace).  2. **Invite people** on that client > invite a *Client admin* (then *Client members*).  3. They sign in with Google and land on the client dashboard.

## What a client sees / what a client ticket is
* A client request is a **Ticket**, never a task. Tasks are internal.
* Raising it notifies managers (in-app + email). When staff assign it, an internal task is auto-created for the assignee; ticket and task status stay in sync.
* Client sees: ticket status in plain words (Received, In progress, Waiting for your review, Done), client-visible comments, project list/status, **project updates** posted by the team, activity for their org. Client admin sees all org tickets; client member only their own.
* Staff status changes, client-visible comments and project updates notify the client (in-app + email). When a ticket is set to *Client review*, the client can **Approve** (closes) or **Send back** (in progress).
* Internal notes, tasks, teams, chat and other clients' data never reach clients (API-filtered).
* Staff post updates: Projects > **Updates** (project members, managers).

## Chat (staff only)
Edit own message (15 min) · delete for everyone (author/manager) · ✓ sent, ✓✓ delivered (recipient online), blue ✓✓ read (groups: everyone) · pin up to 3 per room · `@name` mention: in-app notification always, email if the person is offline.

## Setup
```
cd src && npm install
cp .env.example .env        # DATABASE_URL, AUTH_*, AUTH_GOOGLE_*, SMTP_*, ADMIN_EMAIL
npm run db:generate && npm run db:deploy && npm run db:seed
ADMIN_EMAIL=you@any-domain.com npm run link-admin   # first Platform admin (no prior login needed)
npm run dev                                         # web :5173, api :4000
```
Migration `20261019090000_members_invitations_chat` is additive (new tables/columns only). Google OAuth redirect URI is unchanged.

## Testing
`npm test` (34 tests: RBAC, invitations, chat rules, and HTTP tests of the real routes on an in-memory DB double), `npm run build`, `npm run db:validate`.
Manual: invite a second Google account > sign in > check membership + teams; invite a client admin > raise a ticket > check staff notification > set *Client review* > approve as client; open chat in two browsers and try edit, pin, @mention, ticks.


## Cross-team requests (v4.8.10)
Employees hold `work.cross_team`: they can raise tickets and create tasks for other teams (owner team, shared teams, assignee from those teams). They still cannot triage others' tickets or change assignees afterwards.

## v4.8.18: no Manager role
Roles are now Platform admin, Employee, Client admin and Client member. Every employee holds the permissions the Manager role had (triage, assign, share across teams, projects, ticket delete); the migration converts existing managers to employees. Team and team-member management (`team.manage`) stays with the Platform admin.
