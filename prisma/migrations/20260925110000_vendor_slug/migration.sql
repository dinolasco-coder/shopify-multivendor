-- AlterTable: add slug if missing (SQLite)
-- Prisma db push handles this in production; this migration is for migrate history.
ALTER TABLE "Vendor" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';

UPDATE "Vendor" SET "slug" = "id" WHERE "slug" = '';

CREATE INDEX IF NOT EXISTS "Vendor_shop_slug_idx" ON "Vendor"("shop", "slug");
