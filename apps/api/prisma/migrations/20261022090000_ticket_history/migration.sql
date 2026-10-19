-- Per-ticket history. Additive: creates one table and back-fills a CREATED event for existing tickets.
CREATE TABLE "TicketEvent" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "actorId" TEXT,
  "type" TEXT NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "fromLabel" TEXT,
  "toLabel" TEXT,
  "note" TEXT,
  "clientVisible" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

INSERT INTO "TicketEvent" ("id", "ticketId", "actorId", "type", "note", "clientVisible", "createdAt")
SELECT 'tev_created_' || t."id", t."id", t."requesterId", 'CREATED', t."key", true, t."createdAt" FROM "Ticket" t;
