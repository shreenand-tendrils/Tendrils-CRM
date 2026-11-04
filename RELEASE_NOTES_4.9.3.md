# Tendrils CRM v4.9.3 — Overview accuracy and responsive polish

## Overview and analytics
- Clarified the distinction between the live ticket queue (current status) and activity during the selected date range.
- Renamed the period metrics to **New tickets** and **Tickets closed**, with explicit date-range hints.
- Removed repetitive/low-value metrics and kept the core ticket and task workload indicators.
- Added a visible data-quality note when currently closed tickets have no recorded `closedAt` timestamp; these records cannot be reliably attributed to a historical date range.
- Kept the monthly opened/closed chart and made the mobile metric layout denser and more consistent.
- `Everything I can see` and `Only mine` both refresh status totals, period metrics, and chart data using the API scope.
- Status and overdue metric links preserve the selected personal-work scope in the destination list.
- The ticket list's personal view now includes tickets raised by the signed-in employee as well as tickets assigned to them, matching the analytics definition.
- Task metric links can open the task list with its **My tasks** filter enabled.

## Sidebar and mobile
- Fixed the mobile navigation drawer to the viewport with `overflow: hidden`.
- Kept the brand and user/account area fixed; only the inner navigation list scrolls.
- Improved analytics controls, cards, chart height, and spacing on narrow screens.

## Backend
- Added a count of currently closed tickets that have no `closedAt` timestamp so the dashboard can explain why their historical closure is not included in period totals.
- No schema migration, database reset, authentication, or permission changes required.
