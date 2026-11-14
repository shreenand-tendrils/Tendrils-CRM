# Release 4.9.28 — Discussion/Files white-screen fix

- Fixed a malformed literal `\\n` sequence in `Discussion.jsx` that had commented out the `mentionMap` state declaration.
- This caused a runtime `ReferenceError` when the shared Comments/Files discussion component rendered, which could blank the ticket panel when opening either section.
- Restored the mention state declaration as a real JavaScript line.
- No API, database, permissions, routing, or other workflow changes in this hotfix.
