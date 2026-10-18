-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "autoCreated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Task_ticketId_autoCreated_idx" ON "Task"("ticketId", "autoCreated");
