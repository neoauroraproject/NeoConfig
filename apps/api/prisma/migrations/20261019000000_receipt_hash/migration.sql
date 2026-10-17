-- AlterTable
ALTER TABLE "RenewalRequest" ADD COLUMN "receiptHash" TEXT;

-- CreateIndex
CREATE INDEX "RenewalRequest_brandId_receiptHash_idx" ON "RenewalRequest"("brandId", "receiptHash");
