-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "payoutBankBic" TEXT;

-- AlterTable
ALTER TABLE "VendorPayout" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'succeeded';
ALTER TABLE "VendorPayout" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "VendorPayout" ADD COLUMN "providerTransferId" TEXT;
ALTER TABLE "VendorPayout" ADD COLUMN "providerBatchId" TEXT;
ALTER TABLE "VendorPayout" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "VendorPayout" ADD COLUMN "attributionId" TEXT;

-- CreateIndex
CREATE INDEX "VendorPayout_attributionId_idx" ON "VendorPayout"("attributionId");
CREATE INDEX "VendorPayout_providerTransferId_idx" ON "VendorPayout"("providerTransferId");
