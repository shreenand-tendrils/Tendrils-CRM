# Tendrils Operations & Client Management Platform

JavaScript-first modular monolith based on the uploaded Tendrils Product & System Blueprint. Includes responsive React UI, Express API, Auth.js Google OAuth restricted to verified `@tendrils.io` addresses, PostgreSQL + Prisma, organization membership checks, tickets, tasks, projects, teams, comments, activity, notifications, Nodemailer assignment alerts, and protected local file uploads.

**Honest scope note:** this is a working MVP foundation, not a finished enterprise production system. The blueprint's full configurable automation, approvals, client portal experience, SLA reports, workload forecasting, and AI roadmap need further phases. See `docs/ROADMAP.md`. Real OAuth/SMTP credentials and initial membership provisioning are required.

## Stack / versions
- Node.js >=22.12 (Node 24 LTS recommended)
- React 19, Vite 7, React Router 7, Zustand 5, JavaScript
- Express 5, Auth.js `@auth/express` (official Express integration is experimental), Google OAuth
- Prisma ORM 6.19 line + PostgreSQL 17
- Nodemailer 7, Multer 2, Zod 4

Versions use compatible stable major lines rather than the Prisma 8 release-candidate workflow. Verify package release notes before upgrading.

## Windows PowerShell setup
1. Install Node.js 22.12+ and Docker Desktop.
2. Extract ZIP, open PowerShell in the project root.
3. `npm install`
4. `Copy-Item .env.example .env` and edit the file. Set `AUTH_SECRET` to a random 32+ character secret, and configure Google OAuth + SMTP.
5. `docker compose up -d postgres`
6. `npm run db:generate`
7. `npm run db:migrate -- --name init` (if forwarding fails, run `npm --workspace apps/api exec prisma migrate dev -- --name init`)
8. `npm run db:seed`
9. `npm run dev`
10. Open `http://localhost:5173`; API health check: `http://localhost:4000/health`.

## Google OAuth setup
In Google Cloud Console create an OAuth Web Client. Add authorized JavaScript origin `http://localhost:5173` and redirect URI `http://localhost:4000/auth/callback/google`. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env`. Configure consent screen and test users if the app remains in testing mode. Domain restriction is checked server-side and requires Google to report a verified email. Only users with an active database membership can access APIs.

**Initial access:** OAuth alone does not provision organization membership. After the first login, add the user to the internal Tendrils organization with a manager/admin role using Prisma Studio or SQL. This deliberate bootstrap avoids auto-granting privileges to every address at the domain.

## Database commands
```powershell
npm run db:generate
npm run db:migrate -- --name descriptive_change
npm run db:deploy
npm run db:seed
npm run db:studio
```
Edit `apps/api/prisma/schema.prisma`, generate the client, create/review a migration, and commit both schema + migration. `migrate dev` is for local development; `migrate deploy` is for staging/production. Back up before migrations.

## SMTP / notifications
Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`. Gmail Workspace often requires an App Password if SMTP is allowed by policy. When a ticket/task is assigned, the app creates an in-app notification and attempts to email the assignee. If SMTP isn't configured, it logs that mail was skipped instead of claiming delivery.

## Uploads
Private local storage is used for development. Files are size/type limited, metadata is in PostgreSQL, and downloads require an authenticated user with access to the parent ticket/task. Before production, move object storage to private S3 with short-lived signed URLs and malware scanning. Do not make the bucket public.

## Before production
- Verify Auth.js Express experimental API, session handling, secure cookies and OAuth callback URLs.
- Add tests for cross-tenant access, authorization, input validation and uploads.
- Review role model; implement user/membership administration and a controlled admin bootstrap.
- Configure HTTPS, secrets manager, database backups/PITR, structured logs, alerting and dependency audits.
- Add S3 + SQS/SES + AWS Lambda/API Gateway/RDS integration per `docs/AWS_DEPLOYMENT.md`.

See `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, `docs/AWS_DEPLOYMENT.md`, and `docs/ROADMAP.md`.


## Modular codebase
See [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) for the frontend and backend folder responsibilities and extension conventions. Pages and reusable UI are split under `apps/web/src/pages` and `components`; API resources are split under `apps/api/src/routes`; Express setup and centralized errors live in `config` and `middleware`.


## v4.1: members, invitations, client portal, chat
See `docs/MEMBERS_AND_ACCESS.md` (sign-in model, onboarding, setup, testing). Sign-in is no longer limited to @tendrils.io: any invited Google email works.


## v4.4: fixed sidebar + shared documents
A viewport-fixed sidebar now keeps the user controls visible while its navigation scrolls independently. A Documents page supports private workspace/client files. Apply the new migration with `npm run db:deploy` (production) or `npm run db:migrate -- --name shared_documents` (development), then run `npm run db:generate`. See `docs/SECURITY_REVIEW_V4_4.md`. Chat is not yet encrypted at rest or end-to-end; do not use this build to claim that it is.
