-- Files can now be attached to projects (pasted images in project descriptions). Additive.
ALTER TABLE "Attachment" ADD COLUMN "projectId" TEXT;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Attachment_projectId_idx" ON "Attachment"("projectId");
