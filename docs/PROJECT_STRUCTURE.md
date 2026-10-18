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
- `routes/`: one router per domain/resource; the organization/activity read paths are wired through controllers and repositories as the pattern for further extraction.
- `middleware/`: authentication/authorization and centralized errors.
- `services/`: email and activity/notification side effects.
- `controllers/`: request orchestration, separated from transport declarations.
- `repositories/`: reusable Prisma query methods for data access.
- `errors/`: reusable application error and async handler.
- `validators/`: reusable request validation helpers.
- `db.js`: Prisma client singleton.
- `prisma/`: schema and seed.

Routes are intentionally kept resource-oriented. Next refactor iteration can move individual handler logic into `controllers/` and database query logic into `repositories/` as the MVP expands; do not place new cross-domain business logic in `server.js` or route index files.
