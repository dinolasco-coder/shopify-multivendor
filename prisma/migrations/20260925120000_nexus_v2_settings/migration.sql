-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "defaultCommissionFlat" REAL NOT NULL DEFAULT 0;
ALTER TABLE "AppSettings" ADD COLUMN "allowPublicRegistration" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "commissionFlat" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Vendor" ADD COLUMN "shopifyCollectionHandle" TEXT;
