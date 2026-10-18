-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "logoDarkData" BYTEA,
ADD COLUMN "logoDarkMime" TEXT,
ADD COLUMN "logoDarkUrl" TEXT,
ADD COLUMN "copyJson" TEXT NOT NULL DEFAULT '{}';
