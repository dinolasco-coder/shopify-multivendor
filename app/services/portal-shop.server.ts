import prisma from "../db.server";

/** Normalize to `store.myshopify.com`. */
export function normalizeShopDomain(shop: string): string {
  const s = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!s) return "";
  return s.includes(".") ? s : `${s}.myshopify.com`;
}

/**
 * Single marketplace shop for the vendor portal.
 * Prefers VENDOR_PORTAL_SHOP, else the only shop that has an app Session.
 */
export async function resolveVendorPortalShop(): Promise<string | null> {
  const fromEnv = process.env.VENDOR_PORTAL_SHOP?.trim();
  if (fromEnv) return normalizeShopDomain(fromEnv);

  const shops = await prisma.session.findMany({
    select: { shop: true },
    distinct: ["shop"],
  });
  if (shops.length === 1) return shops[0].shop;
  return null;
}
