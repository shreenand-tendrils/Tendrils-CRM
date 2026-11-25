ALTER TABLE "ChatRoom" ADD COLUMN IF NOT EXISTS "ticketId" TEXT;
ALTER TABLE "ChatRoom" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "ChatRoom_ticketId_key" ON "ChatRoom"("ticketId");
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE IF NOT EXISTS "ChatRoomMember" (
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatRoomMember_pkey" PRIMARY KEY ("roomId","userId")
);
CREATE INDEX IF NOT EXISTS "ChatRoomMember_userId_idx" ON "ChatRoomMember"("userId");
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
