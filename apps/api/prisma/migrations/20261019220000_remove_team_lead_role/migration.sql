-- Consolidate Team Lead into Employee and remove the legacy enum value.
-- Handles both a clean database and a previous partially-applied attempt.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'MemberRole_old' AND n.nspname = current_schema()
  ) THEN
    -- A previous deploy renamed the old enum and created the replacement,
    -- but failed while casting the Membership.role default.
    UPDATE "Membership" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'TEAM_LEAD';
    ALTER TABLE "Membership" ALTER COLUMN "role" DROP DEFAULT;
    ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "MemberRole" USING ("role"::text::"MemberRole");
    DROP TYPE "MemberRole_old";
  ELSE
    -- First application against the original enum.
    UPDATE "Membership" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'TEAM_LEAD';
    ALTER TABLE "Membership" ALTER COLUMN "role" DROP DEFAULT;
    ALTER TYPE "MemberRole" RENAME TO "MemberRole_old";
    CREATE TYPE "MemberRole" AS ENUM ('PLATFORM_ADMIN', 'MANAGER', 'EMPLOYEE', 'CLIENT_ADMIN', 'CLIENT_MEMBER');
    ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "MemberRole" USING ("role"::text::"MemberRole");
    DROP TYPE "MemberRole_old";
  END IF;
  ALTER TABLE "Membership" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE'::"MemberRole";
END $$;
