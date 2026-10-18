-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "autoDecideMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "autoDecideAction" TEXT NOT NULL DEFAULT 'approve';

-- AlterTable
ALTER TABLE "RenewalRequest" ADD COLUMN "autoDecided" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoTriedAt" TIMESTAMP(3);
