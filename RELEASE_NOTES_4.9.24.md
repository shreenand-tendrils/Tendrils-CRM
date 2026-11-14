# Tendrils CRM 4.9.24: Ticket window redesign

Built on 4.9.23. Frontend only: no API change, no database migration.

## Phase 1: New layout (left = understand, right = act)
- **Header:** ticket key, status, priority; Copy link and Edit buttons sit here.
- **Title + one meta line:** "Raised by Rohan Malhotra on 22/10/26 · Sofabed · Updated 22/10/26" (replaces the three oversized boxes).
- **Where it stands:** a 3-step track (Open > Review / Test > Closed) with the current step and its progress, plus a facts strip: Team (and shared teams), Assignee, Collaborators, Tasks done, Due (with "N days overdue"), Open for. Review / Help shows as an "On hold" notice.
- **Next step banner** for people who can route: "choose the team" when unrouted, "assign someone from IT" when unassigned. Clients still get their Approve / Send back / Reply banners.
- **One clean tab bar:** Overview (description + latest activity) · Tasks · Comments & files (count) · History. The route tree lives under Tasks, the full history under History.

## Phase 2: Right side is controls only
- **Status** card: status, progress, priority (lock notice when linked tasks block review).
- **Assignment** card: assignee + collaborators (chips, "Manage" to edit).
- **Team routing** card: owner + shared teams as chips; "Change" opens the form (opens automatically when the ticket is not routed).
- **Just for you:** Flag and Remind me. **Delete this ticket** is a quiet link at the bottom.
- Long hint paragraphs removed. Clients with no controls get a full-width view.

## Phase 3: Shared pieces
- `components/win/WinParts.jsx` (tabs, side card, rows, panel), `TicketJourney.jsx`, `styles/ticket-window.css`.
- The task window uses the same tab bar and meta line.
- Phone: facts become a 2-column grid, side cards stack below.

All permissions and actions are unchanged. Deploy steps are the same as in RELEASE_NOTES_4.9.23.md.

## Update: Comments & files tab and colour
- **Comments / Files switch** inside the tab, each with its own count.
- **Comment box is compact and sits above the thread** (no longer sticky at the bottom), so it can never cover comments. New comments appear right below it, newest first. Attach, visibility and Send are on one row.
- **Files view:** one drop zone ("Add files to this ticket"), then two clear lists: "On the ticket" and "Sent in comments", with View and Download on every file. The old collapsible box is gone.
- **Colour:** soft blue-lilac background behind the cards, tinted card headers, tinted side panel, coloured step track, own comments in lilac and internal notes in amber. White is kept for the cards themselves.
- The new window stylesheet now loads last, so older styles cannot override it.

## Update: History tab is now a route
- One continuous route line from the day the ticket was raised, grouped by date, newest first (toggle to oldest first).
- **Stations** (big coloured circles with a card) for every handoff: Ticket raised, Routed/Moved to a team, Shared with a team, Assigned/Reassigned (with "Priya → Rahul"), Collaborator added/removed, Status changes (Sent for review, Waiting for more information, Closed, Reopened, each with "from → to"), Tasks added/reviewed. Each shows who did it and when.
- **Small dots** on the same line for lighter events: comments, files, priority, due date, edits.
- Colour key above the line (Raised, Team, Person, Status, Review, Closed, Task) and a count of stations so far.
- Filters: Everything, Route & status, Edits, Comments & files.
- Overview still shows the latest 4 events with a link to the full route.
