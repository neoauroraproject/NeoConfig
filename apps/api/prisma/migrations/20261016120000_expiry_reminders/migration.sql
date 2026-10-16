-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "expiryRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PushFollow" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "subId" TEXT NOT NULL,
    "urlEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpiryReminder" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "subId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpiryReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushFollow_subId_idx" ON "PushFollow"("subId");

-- CreateIndex
CREATE UNIQUE INDEX "PushFollow_deviceId_subId_key" ON "PushFollow"("deviceId", "subId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpiryReminder_brandId_subId_kind_key" ON "ExpiryReminder"("brandId", "subId", "kind");

-- AddForeignKey
ALTER TABLE "PushFollow" ADD CONSTRAINT "PushFollow_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PushDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryReminder" ADD CONSTRAINT "ExpiryReminder_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

