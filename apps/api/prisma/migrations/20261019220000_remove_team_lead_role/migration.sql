-- Consolidate Team Lead into Manager. Existing memberships retain access as Employee.
UPDATE "Membership" SET "role" = 'EMPLOYEE' WHERE "role" = 'TEAM_LEAD';
ALTER TYPE "MemberRole" RENAME TO "MemberRole_old";
CREATE TYPE "MemberRole" AS ENUM ('PLATFORM_ADMIN', 'MANAGER', 'EMPLOYEE', 'CLIENT_ADMIN', 'CLIENT_MEMBER');
ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "MemberRole" USING ("role"::text::"MemberRole");
DROP TYPE "MemberRole_old";
