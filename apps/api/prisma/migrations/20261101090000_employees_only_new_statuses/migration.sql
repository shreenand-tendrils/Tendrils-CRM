-- 1) No more Manager role: every Manager becomes an Employee (employees now hold the manager permissions).
UPDATE "Membership" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'MANAGER';
UPDATE "Invitation" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'MANAGER';

-- 2) New ticket status + progress model, open/close timestamps, inline (pasted) images.
CREATE TYPE "TicketProgress" AS ENUM ('IN_PROGRESS', 'QA', 'NEED_MORE_INFO', 'RESOLVED');
ALTER TABLE "Ticket" ADD COLUMN "progress" "TicketProgress";
ALTER TABLE "Ticket" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "Attachment" ADD COLUMN "inline" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Ticket" SET "progress" = (CASE "status"::text
  WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS' WHEN 'REVIEW' THEN 'QA' WHEN 'BLOCKED' THEN 'NEED_MORE_INFO'
  WHEN 'CLIENT_REVIEW' THEN 'RESOLVED' WHEN 'RESOLVED' THEN 'RESOLVED' ELSE NULL END)::"TicketProgress";
UPDATE "Ticket" SET "closedAt" = "updatedAt" WHERE "status"::text = 'CLOSED';
UPDATE "Task" SET "completedAt" = "updatedAt" WHERE "status" = 'DONE';

ALTER TYPE "TicketStatus" RENAME TO "TicketStatus_old";
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'REVIEW_TEST', 'REVIEW_HELP', 'CLOSED');
ALTER TABLE "Ticket" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Ticket" ALTER COLUMN "status" TYPE "TicketStatus" USING (CASE "status"::text
  WHEN 'OPEN' THEN 'OPEN' WHEN 'TRIAGED' THEN 'OPEN' WHEN 'IN_PROGRESS' THEN 'OPEN' WHEN 'REVIEW' THEN 'OPEN'
  WHEN 'BLOCKED' THEN 'REVIEW_HELP' WHEN 'CLIENT_REVIEW' THEN 'REVIEW_TEST' WHEN 'RESOLVED' THEN 'REVIEW_TEST' ELSE 'CLOSED' END)::"TicketStatus";
ALTER TABLE "Ticket" ALTER COLUMN "status" SET DEFAULT 'OPEN';
DROP TYPE "TicketStatus_old";
