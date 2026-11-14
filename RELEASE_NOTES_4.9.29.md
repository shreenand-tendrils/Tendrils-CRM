# Release 4.9.29 — ticket comment and file upload hotfix

- Replaced label-wrapped hidden file inputs with explicit button/keyboard triggers and referenced file inputs for both comment attachments and record-level uploads.
- Snapshot selected File objects before clearing the input value, and ignore empty picker results.
- Added a visible upload-in-progress state and inline error reporting for record-level uploads; refreshes the Files list after upload attempts.
- Expanded the server allow-list to accept common image formats and known document/archive extensions when browsers provide an empty or generic MIME type. Unsupported extensions remain rejected.
- Raised the mention suggestion menu stacking order so it is not obscured by the ticket's sticky tab strip.
- No database migration or unrelated workflow changes.

Validation note: source-level review completed. A full frontend build/API test run was not completed because dependency installation timed out in this environment.
