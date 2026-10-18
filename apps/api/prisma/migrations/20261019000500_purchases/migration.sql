-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "purchaseEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RenewalRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'renewal',
ADD COLUMN "resultUrlEnc" TEXT;
