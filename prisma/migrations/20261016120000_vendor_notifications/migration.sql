-- CreateTable
CREATE TABLE "VendorNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "refKey" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorNotification_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorNotification_vendorId_type_refKey_key" ON "VendorNotification"("vendorId", "type", "refKey");
CREATE INDEX "VendorNotification_vendorId_createdAt_idx" ON "VendorNotification"("vendorId", "createdAt");
CREATE INDEX "VendorNotification_vendorId_readAt_idx" ON "VendorNotification"("vendorId", "readAt");
CREATE INDEX "VendorNotification_shop_vendorId_idx" ON "VendorNotification"("shop", "vendorId");
