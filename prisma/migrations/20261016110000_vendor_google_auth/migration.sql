-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_shop_googleId_key" ON "Vendor"("shop", "googleId");
