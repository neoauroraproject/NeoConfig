-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "purchaseVia" TEXT NOT NULL DEFAULT 'store',
ADD COLUMN "purchaseInbounds" TEXT,
ADD COLUMN "uptimeUrl" TEXT,
ADD COLUMN "uptimeSlug" TEXT,
ADD COLUMN "uptimeKeyEnc" TEXT;
