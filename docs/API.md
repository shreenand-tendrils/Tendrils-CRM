# API overview
Base URL `/api/v1`; Vite proxies `/api`, `/auth`, and `/health` to port 4000.

- `GET /health` public health check
- `GET /api/v1/me`, `/dashboard`
- `GET|POST /api/v1/organizations` (create is manager/admin only)
- `GET|POST /api/v1/projects`
- `GET|POST /api/v1/tickets`, `PATCH /api/v1/tickets/:id`
- `GET|POST /api/v1/tasks`, `PATCH /api/v1/tasks/:id`
- `GET|POST /api/v1/teams` (create manager/admin only)
- `GET /api/v1/users` (internal users only)
- `GET /api/v1/notifications`, `PATCH /api/v1/notifications/:id/read`
- `POST /api/v1/tickets/:id/comments`, `GET /api/v1/tickets/:id/comments`
- `POST /api/v1/files` multipart fields `file` + exactly one of `ticketId` or `taskId`
- `GET /api/v1/files/:id/download`
- `GET /api/v1/activity`

The MVP has baseline Zod validation. Before production, use exhaustive validation, pagination, rate-limit tuning, API integration tests and explicit authorization tests for every route.

## Collaboration endpoints (staff only unless noted)
| Method | Path | Notes |
|---|---|---|
| PUT | `/projects/:id/members` | `{memberIds, leadId?}` — manager or project lead |
| POST/PATCH | `/tasks` , `/tasks/:id` | accepts `assigneeIds: string[]` (multi-assignee) |
| GET | `/chat/rooms` | General + project rooms you can access |
| GET/POST | `/chat/rooms/:id/messages` | `?after=<ISO>` for incremental polling |
| GET/POST | `/updates/mine`, `/updates` | one update per person per day; POST again edits |
| GET | `/admin/overview?date=` | managers only: updates, missing, workload, activity |
| GET | `/admin/updates?from&to&userId` | managers only: history |
