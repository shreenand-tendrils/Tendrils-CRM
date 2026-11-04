# Tendrils CRM v4.9.5 — Analytics lifecycle and personal scope fixes

## Fixed
- Client approval/close through `patchTicket` now writes `closedAt`; reopening clears it.
- Period-based ticket closures are counted from actual `TicketEvent` transitions to `CLOSED`, including a ticket closed and later reopened during the selected period.
- Closure events are deduplicated by ticket for the KPI and monthly chart.
- Legacy closed tickets without status history use `closedAt` as a fallback; records with neither timestamp nor closure history are reported separately.
- `Only mine` includes tickets raised by the signed-in employee, assigned to them, or containing linked tasks assigned to them.
- Ticket list filtering uses the same personal-work definition as Overview, and linked-task assignee metadata is loaded for staff without exposing task content.
- Scope description and KPI hints clarify what the selected range measures.

## Compatibility
- No database migration, reset, or seed is required.
- No authentication, RBAC permission, ticket workflow, or task workflow changes.
- Existing task mirror display continues to prefer the auto-created ticket task.

## Validation
- Backend changed files pass `node --check`.
- Full dependency-backed tests and frontend production build were not run in this environment.
