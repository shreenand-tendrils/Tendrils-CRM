# Security review — v4.4 upgrade

## Changes in this build
- Sidebar has a viewport-height shell; only its navigation area scrolls. Main content scrolls independently. Mobile drawer stays fixed.
- Added shared Documents page, metadata model, migration, authenticated upload/download endpoints, allowlisted extensions, upload size limit inherited from `MAX_UPLOAD_BYTES`, randomized storage keys, and server-side visibility/membership checks. Files are kept outside public web roots.

## Important security limitation: chat encryption
Chat messages in this codebase are still **not end-to-end encrypted** and the `ChatMessage.body` database column is plaintext. Do not represent this build as having encrypted chat. Correct at-rest encryption requires a reviewed key-management design and encryption/decryption at every REST and WebSocket path, including replies, pins, notifications, mentions, edit/delete, and realtime events. End-to-end encryption additionally requires client-side key management and protocol design. This upgrade intentionally does not add a partial encryption shim that would break existing message workflows or falsely imply E2EE.

## Pre-production security checklist
- Set production secrets via a secrets manager; never commit `.env`. Rotate any exposed OAuth/SMTP/database credentials.
- Enforce HTTPS/WSS, secure session cookies, strict allowed origins, and production-disabled dev login.
- Review authorization for every object read/write, including document organization scope and client visibility.
- Add malware scanning, content sniffing, storage quotas, audit events for document access, private S3 with short-lived signed URLs, and backups.
- Run `npm audit`, Prisma schema validation, API authorization tests and frontend build in the target Node version.
- Verify OAuth callback/session behavior because `@auth/express` is marked experimental by its own project.
