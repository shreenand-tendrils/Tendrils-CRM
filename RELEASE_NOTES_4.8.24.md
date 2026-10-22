# Tendrils CRM 4.8.24

## Ticket completion guardrails
- Ticket submission to client review and ticket closure are blocked until all linked work items and nested subtasks are marked `DONE`.
- The same guard runs on direct ticket status updates and when the ticket's auto-created task attempts to move the ticket into review/closed, so task-board changes cannot bypass the rule.
- Ticket status options in the ticket drawer explain when review/closure is locked because linked work remains incomplete.
- API errors use a generic message and do not expose internal task titles to client users.
- Added a unit test for distinguishing actual linked work from the auto-created ticket-mirror task.

## Validation
- JavaScript syntax checks passed for the changed API route/service files.
- Full test run could not complete in this environment because required workspace dependencies (`express`, `zod`, `@prisma/client`, `ws`) are absent; dependency installation timed out.
