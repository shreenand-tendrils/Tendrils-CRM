-- Flags/reminders and the one-time seed marker. Additive.
CREATE TABLE "Reminder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ticketId" TEXT,
  "title" TEXT NOT NULL,
  "remindAt" TIMESTAMP(3),
  "flagged" BOOLEAN NOT NULL DEFAULT false,
  "notifiedAt" TIMESTAMP(3),
  "doneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Reminder_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Reminder_userId_doneAt_idx" ON "Reminder"("userId", "doneAt");
CREATE INDEX "Reminder_remindAt_notifiedAt_idx" ON "Reminder"("remindAt", "notifiedAt");

CREATE TABLE "SeedMarker" (
  "key" TEXT NOT NULL,
  "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeedMarker_pkey" PRIMARY KEY ("key")
);
