-- CreateTable
CREATE TABLE "AppDevice" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "standalone" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "opens" INTEGER NOT NULL DEFAULT 1,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSubscriptionAdd" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "subId" TEXT NOT NULL,
    "displayName" TEXT,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppSubscriptionAdd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppDevice_brandId_deviceId_key" ON "AppDevice"("brandId", "deviceId");
CREATE INDEX "AppDevice_brandId_firstSeen_idx" ON "AppDevice"("brandId", "firstSeen");
CREATE INDEX "AppDevice_brandId_lastSeen_idx" ON "AppDevice"("brandId", "lastSeen");
CREATE UNIQUE INDEX "AppSubscriptionAdd_brandId_deviceId_subId_key" ON "AppSubscriptionAdd"("brandId", "deviceId", "subId");
CREATE INDEX "AppSubscriptionAdd_brandId_createdAt_idx" ON "AppSubscriptionAdd"("brandId", "createdAt");

-- AddForeignKey
ALTER TABLE "AppDevice" ADD CONSTRAINT "AppDevice_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppSubscriptionAdd" ADD CONSTRAINT "AppSubscriptionAdd_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
