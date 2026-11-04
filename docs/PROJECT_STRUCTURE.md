# Project structure guide

## Frontend (`apps/web/src`)
- `pages/`: one file per route/page (Overview, Tickets, Tasks, Projects, Clients, Teams, Activity, Notifications, Settings).
- `components/layout/`: Sidebar, Topbar, PageHeader.
- `components/ui/`: Brand, Avatar, Panel, EmptyState, StatusBadge.
- `components/dashboard/`: metric cards and activity feed.
- `components/tickets/`: ticket table and ticket drawer.
- `components/tasks/`: Kanban board.
- `components/forms/`: reusable entity modal.
- `hooks/`: workspace loading/data hook.
- `lib/`: formatting and navigation constants.
- `store.js`: Zustand global UI state; `api.js`: Axios client.

## Backend (`apps/api/src`)
- `config/`: environment and Express app composition.
- `routes/`: thin transport only — parse the request (`parseBody`/params/query), call a service, shape the response. No domain logic, no Prisma calls beyond a lookup the scope helpers need.
- `middleware/`: request-level concerns only — auth (`requireUser`, permission gates) and centralized errors. Row-scope `where` clauses live in `rbac/scope.js`, not here.
- `rbac/`: role→permission map (`permissions.js`), record-level decisions (`policies.js`), and the Prisma `where`-clause builders for org/team/activity scoping (`scope.js`).
- `services/`: all domain behaviour. `review.js` is the single home for ticket/task review rules and the client-review workflow; `storage.js` is the local-disk upload adapter (the S3 seam); `internalApi.js` + `internalAuth.js` are the "act-as-user" loopback WhatsApp/MCP use; `index.js` is the barrel routes import from.
- `agent/`, `mcp/`, `realtime/`: the MCP tool registry, the MCP HTTP endpoint, and the WebSocket hub/handlers.
- `controllers/` + `repositories/`: the original workspace read path (kept); new domain logic goes in `services/`, not new controller/repository pairs.
- `errors/`: `AppError` + async handler.
- `validators/`: zod schemas and `parseBody`.
- `db.js`: Prisma client singleton.
- `prisma/` (under apps/api): schema, migrations, seed, and data-repair scripts such as `backfill-task-review-access.js` — never route files.

Routes must never carry cross-entity rules, transactions, notifications or backfills; those belong in `services/` (or `prisma/` for one-off repairs).
