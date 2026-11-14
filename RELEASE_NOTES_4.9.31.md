# Release 4.9.31 — Discussion crash and upload hardening

- Fixed a React hooks-order violation in `Discussion.jsx`: the mention-menu `useEffect` sat after the `if (!comments) return` early return, so the hook count changed once comments loaded and could blank the ticket panel. All hooks now run before the early return.
- Mention menu flips below the composer when there is no room above it.
- Draft attachment limit now counts files within a single multi-file selection (state was stale inside the loop).
- API: any Multer error (e.g. unexpected field) returns a 400 with a message instead of a 500.
- Upload picker accepts HEIC/HEIF (already allowed by the server).
- `package.json` version synced to 4.9.31.
- No database, permission, or workflow changes.
