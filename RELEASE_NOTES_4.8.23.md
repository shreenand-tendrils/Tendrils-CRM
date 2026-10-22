# Tendrils Platform 4.8.23

- Client ticket lists now show the owning team and shared team names.
- Employee status controls hide `CLOSED`; the API also rejects employee attempts to close tickets, requiring submission to client review. Platform admins retain administrative status control, and clients can approve or send back work awaiting review.
- Ticket assignment UI clarifies the team-first workflow and restricts the displayed assignees to members of the saved owning/shared teams. Select a destination team, save routing, then choose an employee from that team's roster.
- Overview ticket analytics spacing, monthly chart readability, and metric grouping improved.

Validation: run `npm run check` after installing dependencies. Full production build and live-database behavior must be verified in the target environment.
