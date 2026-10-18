# Architecture

- `apps/web`: React SPA, React Router, Zustand for small client UI state. API data is loaded from Express; the frontend is never an authorization boundary.
- `apps/api`: Express modular monolith, Auth.js Express integration, validation, Prisma data layer, email service and file endpoints.
- PostgreSQL: organizations, memberships, users, projects, tickets, tasks, comments, attachments, notifications and activity.
- Local file storage for development; S3 is the production target.

## Trust boundaries
1. Auth.js checks Google identity (verified email) and that it is an active member or holds an open invitation.
2. Protected API middleware resolves the session user and active memberships from PostgreSQL.
3. Every organization-owned endpoint checks membership/tenant scope server-side.
4. Internal comments are filtered for non-internal users.
5. Production still needs thorough cross-tenant integration tests, CSRF/origin review and complete RBAC policy coverage.

## AWS shape
React static hosting → API Gateway/Lambda (Express adapter) → modular API → RDS PostgreSQL. S3 stores private files. SQS handles retryable email/reminder jobs; SES or approved SMTP sends messages. Secrets Manager, CloudWatch, backups and infrastructure-as-code are required for a real deployment.
