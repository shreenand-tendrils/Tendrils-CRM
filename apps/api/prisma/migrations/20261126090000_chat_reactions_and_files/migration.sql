-- Ticket discussion upgrade: emoji reactions + files sent in chat.
CREATE TABLE "ChatReaction" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatReaction_pkey" PRIMARY KEY ("messageId","userId","emoji")
);
CREATE INDEX "ChatReaction_messageId_idx" ON "ChatReaction"("messageId");
ALTER TABLE "ChatReaction" ADD CONSTRAINT "ChatReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Attachment" ADD COLUMN "chatRoomId" TEXT, ADD COLUMN "chatMessageId" TEXT;
CREATE INDEX "Attachment_chatRoomId_idx" ON "Attachment"("chatRoomId");
CREATE INDEX "Attachment_chatMessageId_idx" ON "Attachment"("chatMessageId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
