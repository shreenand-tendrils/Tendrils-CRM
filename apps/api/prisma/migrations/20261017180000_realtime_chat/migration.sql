-- AlterEnum (transaction-safe for PostgreSQL < 12, which forbids ALTER TYPE ... ADD VALUE
-- inside a transaction: rename, recreate with the new value, re-point the column).
ALTER TYPE "RoomType" RENAME TO "RoomType_old";
CREATE TYPE "RoomType" AS ENUM ('GENERAL', 'PROJECT', 'DIRECT');
ALTER TABLE "ChatRoom" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "ChatRoom" ALTER COLUMN "type" TYPE "RoomType" USING ("type"::text::"RoomType");
ALTER TABLE "ChatRoom" ALTER COLUMN "type" SET DEFAULT 'PROJECT';
DROP TYPE "RoomType_old";

-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN     "directKey" TEXT;

-- CreateTable
CREATE TABLE "ChatRead" (
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRead_pkey" PRIMARY KEY ("roomId","userId")
);

-- CreateIndex
CREATE INDEX "ChatRead_userId_idx" ON "ChatRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoom_directKey_key" ON "ChatRoom"("directKey");

-- AddForeignKey
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRead" ADD CONSTRAINT "ChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
