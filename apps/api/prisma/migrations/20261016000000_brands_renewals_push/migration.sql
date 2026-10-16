-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'RESELLER';

-- DropForeignKey
ALTER TABLE "Branding" DROP CONSTRAINT "Branding_orgId_fkey";

-- AlterTable
ALTER TABLE "PanelConnection" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'xui';

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "appName" TEXT NOT NULL DEFAULT 'NeoConfig',
    "shortName" TEXT NOT NULL DEFAULT 'NeoConfig',
    "tagline" TEXT,
    "logoUrl" TEXT,
    "iconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#4F5BD5',
    "accentColor" TEXT NOT NULL DEFAULT '#FF6A1A',
    "theme" TEXT NOT NULL DEFAULT 'mist',
    "defaultLocale" TEXT NOT NULL DEFAULT 'fa',
    "supportUrl" TEXT,
    "supportTelegram" TEXT,
    "contactEmail" TEXT,
    "allowCopyLink" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "renewalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cardNumber" TEXT,
    "cardHolder" TEXT,
    "bankName" TEXT,
    "renewalNote" TEXT,
    "plansJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandDomain" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "lastCheckAt" TIMESTAMP(3),
    "dnsOk" BOOLEAN,
    "sslOk" BOOLEAN,
    "checkMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "subId" TEXT NOT NULL,
    "subUrlEnc" TEXT NOT NULL,
    "displayName" TEXT,
    "panelId" TEXT,
    "clientRef" TEXT,
    "planId" TEXT NOT NULL,
    "planTitle" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "gb" DOUBLE PRECISION NOT NULL,
    "price" TEXT NOT NULL,
    "payerName" TEXT,
    "payerNote" TEXT,
    "receiptMime" TEXT NOT NULL,
    "receiptData" BYTEA NOT NULL,
    "status" "RenewalStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "appliedOnPanel" BOOLEAN,
    "applyMessage" TEXT,
    "deviceEndpoint" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "subIds" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookupEvent" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookupEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_BrandToPanelConnection" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BrandToPanelConnection_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "Brand_orgId_idx" ON "Brand"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandDomain_domain_key" ON "BrandDomain"("domain");

-- CreateIndex
CREATE INDEX "RenewalRequest_brandId_status_createdAt_idx" ON "RenewalRequest"("brandId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RenewalRequest_subId_idx" ON "RenewalRequest"("subId");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_endpoint_key" ON "PushDevice"("endpoint");

-- CreateIndex
CREATE INDEX "PushDevice_brandId_idx" ON "PushDevice"("brandId");

-- CreateIndex
CREATE INDEX "LookupEvent_brandId_createdAt_idx" ON "LookupEvent"("brandId", "createdAt");

-- Carry existing single-tenant branding over as each organization's default brand
INSERT INTO "Brand" ("id", "orgId", "slug", "appName", "shortName", "logoUrl", "iconUrl",
  "defaultLocale", "supportUrl", "contactEmail", "allowCopyLink", "isDefault", "updatedAt")
SELECT b."id", b."orgId", o."slug", b."appName", b."shortName", b."logoUrl", b."iconUrl",
  'fa', b."supportUrl", b."contactEmail", b."allowCopyLink", true, CURRENT_TIMESTAMP
FROM "Branding" b JOIN "Organization" o ON o."id" = b."orgId";

INSERT INTO "BrandDomain" ("id", "brandId", "domain")
SELECT 'dom_' || b."id", b."id", lower(b."customDomain")
FROM "Branding" b WHERE b."customDomain" IS NOT NULL AND b."customDomain" <> '';

-- DropTable
DROP TABLE "Branding";

-- CreateIndex
CREATE INDEX "_BrandToPanelConnection_B_index" ON "_BrandToPanelConnection"("B");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandDomain" ADD CONSTRAINT "BrandDomain_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalRequest" ADD CONSTRAINT "RenewalRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalRequest" ADD CONSTRAINT "RenewalRequest_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookupEvent" ADD CONSTRAINT "LookupEvent_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BrandToPanelConnection" ADD CONSTRAINT "_BrandToPanelConnection_A_fkey" FOREIGN KEY ("A") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BrandToPanelConnection" ADD CONSTRAINT "_BrandToPanelConnection_B_fkey" FOREIGN KEY ("B") REFERENCES "PanelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

