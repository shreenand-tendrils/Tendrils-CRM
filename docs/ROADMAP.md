# Roadmap aligned to the Tendrils blueprint

## Current MVP foundation
- Auth.js Google OAuth, invitation-based (any verified invited email)
- Membership-based access checks and organization scoping
- Dashboard, clients, projects, ticketing, tasks/Kanban, teams
- Comments with internal/client visibility
- Activity records and in-app notifications
- Nodemailer assignment email (requires SMTP credentials)
- Protected local attachment upload/download

## Next phases
1. Security hardening: cross-tenant integration tests, CSRF/origin review, full role/permission management, admin bootstrap, audit coverage, API schema validation.
2. Workflows: configurable boards/columns, subtasks/dependencies, watchers, labels, milestones, due-date reminders and SLA rules.
3. Client portal: approved client memberships, client dashboards, client requests, client-visible comments/files, approvals and deliverables.
4. Operations: workload/capacity, reports, global search, preferences, exports and recurring tasks.
5. Automation: trigger-condition-action engine, retryable jobs, escalation policies and recurring jobs.
6. AWS: Lambda/API Gateway, RDS, S3, SQS, SES, Secrets Manager, CloudWatch and IaC.
7. Intelligence: AI summaries/routing only after core operational data and governance are stable.

The source blueprint recommends a modular monolith and incremental delivery. This ZIP is a foundation for that, not a claim that all roadmap modules are complete.
