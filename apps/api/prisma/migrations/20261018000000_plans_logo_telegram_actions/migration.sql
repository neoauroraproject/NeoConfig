-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "logoData" BYTEA,
ADD COLUMN     "logoMime" TEXT,
ADD COLUMN     "telegramWebhookSecret" TEXT;

-- AlterTable
ALTER TABLE "RenewalRequest" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'add',
ADD COLUMN     "users" INTEGER NOT NULL DEFAULT 0;

