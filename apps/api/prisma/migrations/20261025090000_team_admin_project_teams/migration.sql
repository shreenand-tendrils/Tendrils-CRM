-- Team admin (active / client-visible) and project teams. Additive.
ALTER TABLE "Team" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Team" ADD COLUMN "clientVisible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD COLUMN "requestedByClient" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ProjectTeam" (
  "projectId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectTeam_pkey" PRIMARY KEY ("projectId","teamId"),
  CONSTRAINT "ProjectTeam_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProjectTeam_teamId_idx" ON "ProjectTeam"("teamId");
