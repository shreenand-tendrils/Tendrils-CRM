-- Multiple collaborators per ticket (additive: one new table, nothing existing is changed).
CREATE TABLE "TicketCollaborator" (
  "ticketId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketCollaborator_pkey" PRIMARY KEY ("ticketId", "userId"),
  CONSTRAINT "TicketCollaborator_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TicketCollaborator_userId_idx" ON "TicketCollaborator"("userId");
