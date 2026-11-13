-- Files sent with a comment are linked to that comment (additive; existing attachments are untouched).
ALTER TABLE "Attachment" ADD COLUMN "commentId" TEXT;
CREATE INDEX "Attachment_commentId_idx" ON "Attachment"("commentId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
