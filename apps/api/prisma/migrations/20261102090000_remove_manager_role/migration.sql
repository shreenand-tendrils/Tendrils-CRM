-- Permanently remove the legacy MANAGER role after converting existing records to EMPLOYEE.
-- Drop enum-typed defaults before changing the column type (PostgreSQL cannot cast them automatically).
UPDATE "Membership" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'MANAGER';
UPDATE "Invitation" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'MANAGER';

ALTER TABLE "Membership" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "Invitation" ALTER COLUMN "role" DROP DEFAULT;

CREATE TYPE "MemberRole_new" AS ENUM ('PLATFORM_ADMIN', 'EMPLOYEE', 'CLIENT_ADMIN', 'CLIENT_MEMBER');
ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "MemberRole_new" USING ("role"::text::"MemberRole_new");
ALTER TABLE "Invitation" ALTER COLUMN "role" TYPE "MemberRole_new" USING ("role"::text::"MemberRole_new");
DROP TYPE "MemberRole";
ALTER TYPE "MemberRole_new" RENAME TO "MemberRole";
ALTER TABLE "Membership" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE'::"MemberRole";
