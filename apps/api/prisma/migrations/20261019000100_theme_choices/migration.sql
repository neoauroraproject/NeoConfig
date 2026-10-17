-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "themeChoices" TEXT[] DEFAULT ARRAY[]::TEXT[];
