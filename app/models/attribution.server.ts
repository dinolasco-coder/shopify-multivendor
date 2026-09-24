import prisma from "../db.server";

export async function upsertOrderAttributions(
  attributions: Array<{
    shop: string;
    shopifyOrderId: string;
    shopifyOrderName?: string | null;
    vendorId: string;
    lineItemIds: string[];
    lineItemsJson: unknown;
    subtotal: number;
    commissionAmount: number;
    currency: string;
  }>,
) {
  for (const attr of attributions) {
    await prisma.orderAttribution.upsert({
      where: {
        shop_shopifyOrderId_vendorId: {
          shop: attr.shop,
          shopifyOrderId: attr.shopifyOrderId,
          vendorId: attr.vendorId,
        },
      },
      create: {
        shop: attr.shop,
        shopifyOrderId: attr.shopifyOrderId,
        shopifyOrderName: attr.shopifyOrderName ?? null,
        vendorId: attr.vendorId,
        lineItemIds: JSON.stringify(attr.lineItemIds),
        lineItemsJson: JSON.stringify(attr.lineItemsJson),
        subtotal: attr.subtotal,
        commissionAmount: attr.commissionAmount,
        currency: attr.currency,
      },
      update: {
        shopifyOrderName: attr.shopifyOrderName ?? null,
        lineItemIds: JSON.stringify(attr.lineItemIds),
        lineItemsJson: JSON.stringify(attr.lineItemsJson),
        subtotal: attr.subtotal,
        commissionAmount: attr.commissionAmount,
        currency: attr.currency,
      },
    });
  }
}

export async function listAttributionsForShop(shop: string) {
  return prisma.orderAttribution.findMany({
    where: { shop },
    include: { vendor: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function listAttributionsForVendor(vendorId: string) {
  return prisma.orderAttribution.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
  });
}

export async function salesSummaryForVendor(vendorId: string) {
  const rows = await prisma.orderAttribution.findMany({
    where: { vendorId },
  });
  const revenue = rows.reduce((sum, r) => sum + r.subtotal, 0);
  const commission = rows.reduce((sum, r) => sum + r.commissionAmount, 0);
  return {
    orderCount: rows.length,
    revenue,
    commission,
    vendorEarnings: revenue - commission,
    currency: rows[0]?.currency ?? "USD",
  };
}

export async function salesSummaryForShop(shop: string) {
  const rows = await prisma.orderAttribution.findMany({ where: { shop } });
  const revenue = rows.reduce((sum, r) => sum + r.subtotal, 0);
  const commission = rows.reduce((sum, r) => sum + r.commissionAmount, 0);
  return {
    orderCount: new Set(rows.map((r) => r.shopifyOrderId)).size,
    attributionCount: rows.length,
    revenue,
    commission,
    currency: rows[0]?.currency ?? "USD",
  };
}
