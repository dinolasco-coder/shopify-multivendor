-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';

-- Unique placeholder from id (app can keep or you can rename later)
UPDATE "Vendor" SET "slug" = "id" WHERE "slug" = '';

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_shop_slug_key" ON "Vendor"("shop", "slug");
