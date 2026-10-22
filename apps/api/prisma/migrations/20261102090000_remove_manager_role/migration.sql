-- Permanently remove the legacy MANAGER role after converting existing records to EMPLOYEE.
UPDATE "Membership" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'MANAGER';
UPDATE "Invitation" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'MANAGER';
CREATE TYPE "MemberRole_new" AS ENUM ('PLATFORM_ADMIN', 'EMPLOYEE', 'CLIENT_ADMIN', 'CLIENT_MEMBER');
ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "MemberRole_new" USING ("role"::text::"MemberRole_new");
ALTER TABLE "Invitation" ALTER COLUMN "role" TYPE "MemberRole_new" USING ("role"::text::"MemberRole_new");
DROP TYPE "MemberRole";
ALTER TYPE "MemberRole_new" RENAME TO "MemberRole";
