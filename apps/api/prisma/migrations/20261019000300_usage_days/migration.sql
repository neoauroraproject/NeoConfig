-- CreateTable
CREATE TABLE "UsageDay" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "subId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "usedBytes" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageDay_brandId_subId_day_key" ON "UsageDay"("brandId", "subId", "day");

-- CreateIndex
CREATE INDEX "UsageDay_brandId_subId_idx" ON "UsageDay"("brandId", "subId");
