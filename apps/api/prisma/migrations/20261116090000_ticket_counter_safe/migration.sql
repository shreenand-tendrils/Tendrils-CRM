-- v4.9.9: idempotent. TicketCounter already exists on live DB (lastNumber); this only creates it on fresh installs.
CREATE TABLE IF NOT EXISTS "TicketCounter" (
  "prefix" TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "TicketCounter_pkey" PRIMARY KEY ("prefix")
);
