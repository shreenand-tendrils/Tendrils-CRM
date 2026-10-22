-- Safely remove the legacy MANAGER role.
UPDATE "Membership"
SET "role" = 'EMPLOYEE'
WHERE "role"::text = 'MANAGER';

UPDATE "Invitation"
SET "role" = 'EMPLOYEE'
WHERE "role"::text = 'MANAGER';

-- Clean up a temporary enum left by an earlier failed attempt.
DROP TYPE IF EXISTS "MemberRole_new";

CREATE TYPE "MemberRole_new" AS ENUM (
  'PLATFORM_ADMIN',
  'EMPLOYEE',
  'CLIENT_ADMIN',
  'CLIENT_MEMBER'
);

-- Drop the old enum-backed default before converting the column.
ALTER TABLE "Membership"
  ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "Membership"
  ALTER COLUMN "role" TYPE "MemberRole_new"
  USING ("role"::text::"MemberRole_new");

ALTER TABLE "Invitation"
  ALTER COLUMN "role" TYPE "MemberRole_new"
  USING ("role"::text::"MemberRole_new");

DROP TYPE "MemberRole";
ALTER TYPE "MemberRole_new" RENAME TO "MemberRole";

ALTER TABLE "Membership"
  ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE'::"MemberRole";
