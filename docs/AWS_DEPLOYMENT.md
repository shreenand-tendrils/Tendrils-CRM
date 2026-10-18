# AWS deployment plan (not deployed by this ZIP)
1. Build `apps/web` and host static assets on S3 + CloudFront, or an approved static hosting platform.
2. Adapt Express to API Gateway + Lambda with a maintained adapter such as `serverless-http`; test Auth.js cookies/callback handling in that runtime first.
3. Use RDS PostgreSQL/Aurora in private subnets with TLS, backups/PITR and appropriate connection pooling/RDS Proxy.
4. Use a private S3 bucket for attachments, encryption, lifecycle rules, signed URLs and file scanning.
5. Use SES or verified SMTP for email and SQS + DLQ for retryable reminders/assignment notifications. Ensure idempotency.
6. Put secrets in Secrets Manager/SSM; use IAM least privilege.
7. Add CloudWatch structured logs, alarms, metrics, tracing and redaction.
8. Provision environments with Terraform or AWS CDK. CI/CD should test, migrate staging, smoke test and deploy controlled releases.
9. Review the experimental status of `@auth/express` before committing to it for production.
