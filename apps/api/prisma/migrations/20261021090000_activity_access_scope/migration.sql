-- Member/invitation/team-membership audit events used entityType 'organization' (all with action 'updated');
-- re-tag them as 'access' so only admins see them. Organization creation ('created') is unchanged.
UPDATE "ActivityLog" SET "entityType" = 'access' WHERE "entityType" = 'organization' AND "action" = 'updated';
