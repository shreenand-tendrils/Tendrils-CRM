-- v4.8.17: remove the separate Manager role in practice. Legacy enum value remains for safe rolling deploys.
UPDATE "Membership" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'MANAGER';
UPDATE "Invitation" SET "role" = 'EMPLOYEE' WHERE "role"::text = 'MANAGER';
-- Rebuild the enum so Manager is no longer a valid assignable database role.
ALTER TABLE "Membership" ALTER COLUMN "role" DROP DEFAULT;
ALTER TYPE "MemberRole" RENAME TO "MemberRole_old";
CREATE TYPE "MemberRole" AS ENUM ('PLATFORM_ADMIN', 'EMPLOYEE', 'CLIENT_ADMIN', 'CLIENT_MEMBER');
ALTER TABLE "Membership" ALTER COLUMN "role" TYPE "MemberRole" USING ("role"::text::"MemberRole");
ALTER TABLE "Invitation" ALTER COLUMN "role" TYPE "MemberRole" USING ("role"::text::"MemberRole");
DROP TYPE "MemberRole_old";
ALTER TABLE "Membership" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE'::"MemberRole";
-- Retire old demo teams without deleting records referenced by tickets/tasks/history.
UPDATE "Team" SET "isActive" = false WHERE lower("name") NOT IN ('it','seo','graphics','products','marketing','facebook ads','google ads');
-- Create the canonical team set for every internal organization.
INSERT INTO "Team" ("id", "name", "slug", "organizationId", "description", "isActive", "clientVisible", "createdAt")
SELECT gen_random_uuid()::text, v.name, v.slug, o."id", v.name || ' team', true, true, NOW()
FROM "Organization" o CROSS JOIN (VALUES
 ('IT','it'), ('SEO','seo'), ('Graphics','graphics'), ('Products','products'), ('Marketing','marketing'), ('Facebook ads','facebook-ads'), ('google ads','google-ads')
) AS v(name,slug)
WHERE o."type" = 'INTERNAL'
ON CONFLICT ("organizationId", "slug") DO UPDATE SET "name" = EXCLUDED."name", "isActive" = true, "clientVisible" = true;
