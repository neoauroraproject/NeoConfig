-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "renewalVia" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN "renewalPanelId" TEXT;

-- AlterTable
ALTER TABLE "RenewalRequest" ADD COLUMN "externalOrderId" TEXT,
ADD COLUMN "externalCode" TEXT,
ADD COLUMN "externalSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RenewalRequest_status_externalOrderId_idx" ON "RenewalRequest"("status", "externalOrderId");
