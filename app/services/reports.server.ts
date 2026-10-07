import prisma from "../db.server";
import { listMarketplaceProducts } from "./products.server";
import {
  shopifyCreatedAtQuery,
  type ReportPeriod,
  getReportPeriodRange,
} from "../utils/report-period";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ReportMetrics = {
  period: ReportPeriod;
  rangeLabel: string;
  startIso: string;
  endIso: string;
  revenue: number;
  currency: string;
  orderCount: number;
  customers: number;
  productsNew: number;
  productsActive: number;
  inventoryUnits: number;
  marketplaceRevenue: number;
};

async function fetchShopifyPeriodOrders(
  admin: AdminGraphql,
  start: Date,
  end: Date,
): Promise<{
  revenue: number;
  currency: string;
  orderCount: number;
  customers: number;
}> {
  const query = `${shopifyCreatedAtQuery(start, end)} status:any`;
  const response = await admin.graphql(
    `#graphql
    query marketplaceReportOrders($first: Int!, $query: String) {
      ordersCount(query: $query) { count }
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          email
          cancelledAt
          currentTotalPriceSet {
            shopMoney { amount currencyCode }
          }
        }
      }
    }`,
    { variables: { first: 100, query } },
  );
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(
      json.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }

  const nodes = (json.data?.orders?.nodes ?? []) as Array<{
    email?: string | null;
    cancelledAt?: string | null;
    currentTotalPriceSet?: {
      shopMoney?: { amount?: string; currencyCode?: string };
    };
  }>;

  let revenue = 0;
  let currency = "PHP";
  const emails = new Set<string>();
  for (const order of nodes) {
    if (order.cancelledAt) continue;
    revenue += Number(order.currentTotalPriceSet?.shopMoney?.amount ?? 0);
    currency =
      order.currentTotalPriceSet?.shopMoney?.currencyCode || currency;
    const email = String(order.email || "")
      .trim()
      .toLowerCase();
    if (email) emails.add(email);
  }

  return {
    revenue,
    currency,
    orderCount: Number(json.data?.ordersCount?.count ?? nodes.length),
    customers: emails.size,
  };
}

async function fetchProductsCreatedCount(
  admin: AdminGraphql,
  start: Date,
  end: Date,
) {
  const query = shopifyCreatedAtQuery(start, end);
  const response = await admin.graphql(
    `#graphql
    query marketplaceReportProducts($query: String) {
      productsCount(query: $query) { count }
      activeProductsCount: productsCount(query: "status:active") { count }
    }`,
    { variables: { query } },
  );
  const json = await response.json();
  return {
    productsNew: Number(json.data?.productsCount?.count ?? 0),
    productsActive: Number(json.data?.activeProductsCount?.count ?? 0),
  };
}

async function marketplaceInventory(
  admin: AdminGraphql,
  vendorId?: string,
): Promise<{ inventoryUnits: number; productsActive: number }> {
  const products = (await listMarketplaceProducts(admin, {
    vendorId,
    first: 100,
  })) as Array<{
    status?: string;
    totalInventory?: number | null;
    metafield?: { value?: string } | null;
  }>;

  let inventoryUnits = 0;
  let productsActive = 0;
  for (const p of products) {
    inventoryUnits += Math.max(0, Number(p.totalInventory ?? 0));
    if (String(p.status || "").toUpperCase() === "ACTIVE") productsActive += 1;
  }
  return { inventoryUnits, productsActive };
}

async function marketplaceRevenueInRange(
  shop: string,
  start: Date,
  end: Date,
  vendorId?: string,
) {
  const rows = await prisma.orderAttribution.findMany({
    where: {
      shop,
      ...(vendorId ? { vendorId } : {}),
      createdAt: { gte: start, lte: end },
    },
    select: { subtotal: true, currency: true, shopifyOrderId: true },
  });
  const revenue = rows.reduce((sum, r) => sum + r.subtotal, 0);
  return {
    marketplaceRevenue: revenue,
    currency: rows[0]?.currency ?? "PHP",
    attributionOrders: new Set(rows.map((r) => r.shopifyOrderId)).size,
  };
}

export async function buildShopReport(
  admin: AdminGraphql,
  shop: string,
  period: ReportPeriod,
): Promise<ReportMetrics> {
  const { start, end, label } = getReportPeriodRange(period);

  const [orders, products, inventory, market] = await Promise.all([
    fetchShopifyPeriodOrders(admin, start, end).catch(() => ({
      revenue: 0,
      currency: "PHP",
      orderCount: 0,
      customers: 0,
    })),
    fetchProductsCreatedCount(admin, start, end).catch(() => ({
      productsNew: 0,
      productsActive: 0,
    })),
    marketplaceInventory(admin).catch(() => ({
      inventoryUnits: 0,
      productsActive: 0,
    })),
    marketplaceRevenueInRange(shop, start, end),
  ]);

  return {
    period,
    rangeLabel: label,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    revenue: orders.revenue,
    currency: orders.currency || market.currency,
    orderCount: orders.orderCount,
    customers: orders.customers,
    productsNew: products.productsNew,
    productsActive: Math.max(products.productsActive, inventory.productsActive),
    inventoryUnits: inventory.inventoryUnits,
    marketplaceRevenue: market.marketplaceRevenue,
  };
}

export async function buildVendorReport(
  admin: AdminGraphql,
  shop: string,
  vendorId: string,
  period: ReportPeriod,
): Promise<ReportMetrics> {
  const { start, end, label } = getReportPeriodRange(period);

  const attributions = await prisma.orderAttribution.findMany({
    where: {
      vendorId,
      createdAt: { gte: start, lte: end },
    },
    select: {
      subtotal: true,
      currency: true,
      shopifyOrderId: true,
    },
  });

  const marketplaceRevenue = attributions.reduce((s, r) => s + r.subtotal, 0);
  const orderIds = [...new Set(attributions.map((a) => a.shopifyOrderId))];
  const currency = attributions[0]?.currency ?? "PHP";

  // Unique customers from this seller's orders in the period.
  const emails = new Set<string>();
  await Promise.all(
    orderIds.slice(0, 40).map(async (id) => {
      try {
        const response = await admin.graphql(
          `#graphql
          query vendorReportOrderEmail($id: ID!) {
            order(id: $id) {
              email
              cancelledAt
            }
          }`,
          { variables: { id } },
        );
        const json = await response.json();
        const order = json.data?.order;
        if (!order || order.cancelledAt) return;
        const email = String(order.email || "")
          .trim()
          .toLowerCase();
        if (email) emails.add(email);
      } catch {
        // ignore single-order failures
      }
    }),
  );

  const inventory = await marketplaceInventory(admin, vendorId).catch(() => ({
    inventoryUnits: 0,
    productsActive: 0,
  }));

  // Seller "new products" ≈ active marketplace products they own (Shopify
  // product created_at isn't vendor-filtered easily without metafield search).
  const productsNew = inventory.productsActive;

  return {
    period,
    rangeLabel: label,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    revenue: marketplaceRevenue,
    currency,
    orderCount: orderIds.length,
    customers: emails.size,
    productsNew,
    productsActive: inventory.productsActive,
    inventoryUnits: inventory.inventoryUnits,
    marketplaceRevenue,
  };
}
