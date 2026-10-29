-- v4.9.0: WhatsApp connectivity + personal access tokens (MCP)
CREATE TYPE "WaLinkStatus" AS ENUM ('PENDING', 'ACTIVE');
CREATE TYPE "WaDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "WhatsAppLink" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "phone" TEXT,
  "status" "WaLinkStatus" NOT NULL DEFAULT 'PENDING',
  "codeHash" TEXT,
  "codeExpiresAt" TIMESTAMP(3),
  "notifyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "notifyTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
  "windowOpenUntil" TIMESTAMP(3),
  "context" JSONB,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppLink_userId_key" ON "WhatsAppLink"("userId");
CREATE UNIQUE INDEX "WhatsAppLink_phone_key" ON "WhatsAppLink"("phone");
CREATE INDEX "WhatsAppLink_codeHash_idx" ON "WhatsAppLink"("codeHash");
ALTER TABLE "WhatsAppLink" ADD CONSTRAINT "WhatsAppLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhatsAppMessage" (
  "id" TEXT NOT NULL,
  "waId" TEXT,
  "direction" "WaDirection" NOT NULL,
  "phone" TEXT NOT NULL,
  "userId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'text',
  "body" TEXT,
  "status" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppMessage_waId_key" ON "WhatsAppMessage"("waId");
CREATE INDEX "WhatsAppMessage_userId_createdAt_idx" ON "WhatsAppMessage"("userId", "createdAt");
CREATE INDEX "WhatsAppMessage_phone_createdAt_idx" ON "WhatsAppMessage"("phone", "createdAt");

CREATE TABLE "ApiToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
CREATE INDEX "ApiToken_userId_revokedAt_idx" ON "ApiToken"("userId", "revokedAt");
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
