-- CreateTable
CREATE TABLE "CustomizationRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "attributionId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT,
    "productTitle" TEXT,
    "customerNote" TEXT,
    "imageUrlsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sellerNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomizationRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomizationRequest_attributionId_key" ON "CustomizationRequest"("attributionId");
CREATE INDEX "CustomizationRequest_vendorId_status_idx" ON "CustomizationRequest"("vendorId", "status");
CREATE INDEX "CustomizationRequest_shop_vendorId_idx" ON "CustomizationRequest"("shop", "vendorId");
