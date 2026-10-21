-- Team-scoped tickets and tasks. Additive migration: no existing columns/tables are dropped.
ALTER TABLE "Task" ADD COLUMN "teamId" TEXT;
CREATE INDEX "Task_teamId_status_idx" ON "Task"("teamId", "status");
ALTER TABLE "Task" ADD CONSTRAINT "Task_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TicketTeamAccess" (
  "ticketId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "accessRole" TEXT NOT NULL DEFAULT 'PARTICIPANT',
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketTeamAccess_pkey" PRIMARY KEY ("ticketId", "teamId"),
  CONSTRAINT "TicketTeamAccess_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketTeamAccess_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TicketTeamAccess_teamId_ticketId_idx" ON "TicketTeamAccess"("teamId", "ticketId");

CREATE TABLE "TaskTeamAccess" (
  "taskId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "accessRole" TEXT NOT NULL DEFAULT 'PARTICIPANT',
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskTeamAccess_pkey" PRIMARY KEY ("taskId", "teamId"),
  CONSTRAINT "TaskTeamAccess_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskTeamAccess_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskTeamAccess_teamId_taskId_idx" ON "TaskTeamAccess"("teamId", "taskId");

-- Existing team-owned tickets are visible only to their owning team plus the explicit participants.
INSERT INTO "TicketTeamAccess" ("ticketId", "teamId", "accessRole")
SELECT "id", "teamId", 'OWNER' FROM "Ticket" WHERE "teamId" IS NOT NULL
ON CONFLICT DO NOTHING;
-- Existing tasks inherit their ticket's explicit team access; standalone tasks get their teamId access.
UPDATE "Task" t SET "teamId" = tk."teamId" FROM "Ticket" tk
WHERE t."ticketId" = tk."id" AND t."teamId" IS NULL AND tk."teamId" IS NOT NULL;
INSERT INTO "TaskTeamAccess" ("taskId", "teamId", "accessRole")
SELECT "id", "teamId", 'OWNER' FROM "Task" WHERE "teamId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Copy the ticket boundary to its generated work item and all descendant subtasks.
WITH RECURSIVE inherited("taskId", "teamId") AS (
  SELECT t."id", tta."teamId"
  FROM "Task" t JOIN "TicketTeamAccess" tta ON tta."ticketId" = t."ticketId"
  UNION
  SELECT child."id", inherited."teamId"
  FROM "Task" child JOIN inherited ON child."parentId" = inherited."taskId"
)
INSERT INTO "TaskTeamAccess" ("taskId", "teamId", "accessRole")
SELECT "taskId", "teamId", 'PARTICIPANT' FROM inherited
ON CONFLICT DO NOTHING;
