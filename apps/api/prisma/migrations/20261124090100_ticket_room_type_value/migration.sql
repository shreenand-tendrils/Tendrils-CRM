-- Kept in its own migration: PostgreSQL will not run ALTER TYPE ... ADD VALUE inside a multi-statement script.
ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'TICKET';
