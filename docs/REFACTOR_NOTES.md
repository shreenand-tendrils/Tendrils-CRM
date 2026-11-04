# Refactor notes — architecture cleanup (working doc)

Base: `a0f7d60` (GitHub `main`, v4.9.0). Goal: the seven structural issues from the codebase-design review. No behaviour changes; the code stays the source of truth. Baseline tests: **102 pass / 9 fail** (the 9 are pre-existing env-dependent failures in `members.http.test.js` + `chat.test.js`; they need a live DB/Google session and fail identically before and after every change).

## Issues and planned fixes

| # | Issue | Fix | Status |
|---|-------|-----|--------|
| 2 | Review logic fragmented across `ticketReview.js`, `ticketReviewRules.js`, `taskReviewRules.js`, `taskClientReview.js`, `ticketWorkRules.js` | Consolidated into `services/review.js` (pure rules on top, client-review workflow at bottom). Dead exports dropped: `notifyReviewReady`, `employeeIds` (zero callers). Commit `5d41fd7`. | done |
| 7 | `assignees.js`, `taskComments.js` ≤300-byte fragments | `resolveAssignees` + `taskCommentRecipients` now live in `review.js` and ride the `services/index.js` barrel. `notes.js` kept — cohesive 40-line domain validator, not a fragment. | done |
| 4 | Scope helpers (`orgScope`, `ticketScope`, `taskTeamScope`, `activityScope`, `internalTeamIds`, `canSeeOrg`, `isManager`) in `middleware/` | Moved verbatim to `rbac/scope.js`; `auth.middleware.js` re-exports so every call site still imports from `middleware/index.js`. Commit `21f03de`. | done |
| 3 | `ensureLegacyTaskReviewAccess()` backfill inside `tasks.routes.js`, run on every `GET /tasks` | Moved to `prisma/backfill-task-review-access.js` (idempotent, also runnable as `node prisma/backfill-task-review-access.js`); `server.js` calls `backfillTaskReviewAccessOnce()` at start. Commit `ab1f76b`. | done |
| 1 | Ticket/task handlers hold domain logic; only reachable via HTTP | Extracted into `services/tasks.service.js` + `services/tickets.service.js` behind `ctx`-first interfaces (`listTasks`, `createTask`, `patchTask`, `listTickets`, `createTicket`, `patchTicket`, comments/history/review/delete helpers). `ctxOf(req)` in `auth.middleware.js` produces the auth context; route files are parse→call→respond (38 and 49 lines). Dead imports dropped. Commit `9661ad7`. | done |
| 5 | `App.jsx` 454 lines: router + modal/drawer + workspace load + realtime | Split: `App.jsx` is now a 37-line gate (loading / sign-in / shell); `components/layout/WorkspaceShell.jsx` owns layout, routes, drawers, modal, toast, realtime and chat-unread; `hooks/useTicketDrawer.js` owns drawer state + ?ticket/?task deep-linking; `components/layout/SignInScreen.jsx` extracted unchanged. Review found + fixed a toast-state bug before commit. Commit `801097a`. | done |
| 6 | Upload path logic duplicated (`path.resolve(env.uploadDir)` in files + documents routes); S3 interface premature | `services/storage.js` exposes `uploadDir()`, `diskStorage()`, `storagePath()`, `discard()` — local-disk adapter now, the seam S3 slots into later. `files.routes`, `documents.routes` and `tickets.service.deleteTicket` all go through it. Bonus fix: `files.routes.js` used `AppError` without importing it (delete path would have crashed). Commits `9443870`, `b975649`. | done |

## Consolidation map (point 2)

`services/review.js` owns every review/work-completion rule:

- From `ticketReviewRules.js`: `MANAGER_REVIEW_STATUSES`, `NEEDS_MANAGER_REVIEW_MESSAGE`, `finishBlocked`, `canDeleteTicket`
- From `taskReviewRules.js`: `taskReviewerTeamIds`, `canApproveTask`, `taskNeedsTeamReview`, `REVIEW_KINDS`, `reviewAuthorityOf`, `canFinishTask`, `REVIEW_HINT`
- From `ticketWorkRules.js`: `incompleteWorkTasks`
- From `taskClientReview.js`: `ON_LAST_APPROVAL`, `recordClientReviewRequest`, `reviewTaskAsClient`
- From `taskComments.js`: `taskCommentRecipients`
- Dropped dead code: `ticketReview.js`'s `employeeIds`, `notifyReviewReady`, and the `ticketReview.js` re-export shim itself.

Frontend mirror note: `apps/web/src/lib/taskReview.js` + `rbac.js` intentionally mirror these rules client-side for UI affordance (buttons/disabled states). That duplication is documented and stays — the API remains the authority.
