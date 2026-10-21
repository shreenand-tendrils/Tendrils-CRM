CREATE TABLE "Document" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "originalName" TEXT NOT NULL, "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "category" TEXT NOT NULL DEFAULT 'GENERAL',
  "visibility" "Visibility" NOT NULL DEFAULT 'INTERNAL', "organizationId" TEXT, "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");
CREATE INDEX "Document_organizationId_visibility_createdAt_idx" ON "Document"("organizationId", "visibility", "createdAt");
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
