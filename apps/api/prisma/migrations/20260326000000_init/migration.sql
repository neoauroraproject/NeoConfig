-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ORG_ADMIN', 'USER');
CREATE TYPE "ServerStatus" AS ENUM ('PENDING', 'ONLINE', 'OFFLINE', 'REVOKED');
CREATE TYPE "SyncState" AS ENUM ('NEVER', 'OK', 'STALE', 'FAILED');
CREATE TYPE "QuotaKind" AS ENUM ('KNOWN', 'UNLIMITED', 'UNKNOWN');
CREATE TYPE "ExpiryKind" AS ENUM ('KNOWN', 'NONE', 'UNKNOWN');
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'DISABLED', 'UNKNOWN');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "orgId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Branding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "appName" TEXT NOT NULL DEFAULT 'NeoConfig',
    "shortName" TEXT NOT NULL DEFAULT 'NeoConfig',
    "logoUrl" TEXT,
    "logoDarkUrl" TEXT,
    "iconUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#3B82F6',
    "accentColor" TEXT NOT NULL DEFAULT '#22D3EE',
    "themeDefault" TEXT NOT NULL DEFAULT 'dark',
    "fontFamily" TEXT NOT NULL DEFAULT 'Geist',
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "enabledLocales" TEXT NOT NULL DEFAULT 'en,fa,ar',
    "supportUrl" TEXT,
    "termsUrl" TEXT,
    "privacyUrl" TEXT,
    "contactEmail" TEXT,
    "customDomain" TEXT,
    "allowCopyLink" BOOLEAN NOT NULL DEFAULT true,
    "pwaThemeColor" TEXT NOT NULL DEFAULT '#0F1115',
    "pwaBgColor" TEXT NOT NULL DEFAULT '#0F1115',
    CONSTRAINT "Branding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Branding_orgId_key" ON "Branding"("orgId");
CREATE UNIQUE INDEX "Branding_customDomain_key" ON "Branding"("customDomain");
ALTER TABLE "Branding" ADD CONSTRAINT "Branding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PanelConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "authMode" TEXT NOT NULL DEFAULT 'bearer',
    "webBasePath" TEXT NOT NULL DEFAULT '',
    "subPathHint" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PanelConnection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PanelConnection" ADD CONSTRAINT "PanelConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "agentVersion" TEXT,
    "status" "ServerStatus" NOT NULL DEFAULT 'PENDING',
    "credentialHash" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "panelBaseUrl" TEXT,
    "panelCredsEnc" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Server" ADD CONSTRAINT "Server_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EnrollmentToken" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnrollmentToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnrollmentToken_tokenHash_key" ON "EnrollmentToken"("tokenHash");
ALTER TABLE "EnrollmentToken" ADD CONSTRAINT "EnrollmentToken_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnrollmentToken" ADD CONSTRAINT "EnrollmentToken_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "color" TEXT,
    "urlEnc" TEXT NOT NULL,
    "urlFingerprint" TEXT NOT NULL,
    "subIdHint" TEXT,
    "panelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SubscriptionSnapshot" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "uploadBytes" BIGINT,
    "downloadBytes" BIGINT,
    "totalUsedBytes" BIGINT,
    "quotaBytes" BIGINT,
    "remainingBytes" BIGINT,
    "quotaKind" "QuotaKind" NOT NULL DEFAULT 'UNKNOWN',
    "expiryAt" TIMESTAMP(3),
    "expiryKind" "ExpiryKind" NOT NULL DEFAULT 'UNKNOWN',
    "enabled" BOOLEAN,
    "dataSource" TEXT NOT NULL DEFAULT 'unknown',
    "syncState" "SyncState" NOT NULL DEFAULT 'NEVER',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "rawMetaJson" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionSnapshot_subscriptionId_key" ON "SubscriptionSnapshot"("subscriptionId");
ALTER TABLE "SubscriptionSnapshot" ADD CONSTRAINT "SubscriptionSnapshot_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HmPanelConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "baseUrl" TEXT,
    "credentialsEnc" TEXT,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HmPanelConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HmPanelConnection_orgId_key" ON "HmPanelConnection"("orgId");
ALTER TABLE "HmPanelConnection" ADD CONSTRAINT "HmPanelConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "resourceId" TEXT,
    "ip" TEXT,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
