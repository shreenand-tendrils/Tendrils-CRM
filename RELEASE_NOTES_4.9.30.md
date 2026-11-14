# Release 4.9.30 — mention picker layering fix

- Rendered the @mention suggestion menu in a document-level portal instead of inside the clipped ticket panel.
- Anchored the menu to the comment composer and repositioned it on scroll and resize.
- Applied a high fixed stacking layer so sticky ticket tabs cannot cover suggestions.
- No API, database, upload, email, permission, or ticket workflow changes.

Upload diagnosis remains separate: this screenshot demonstrates the mention dropdown layering issue, but does not show the result/status of the file upload request.
