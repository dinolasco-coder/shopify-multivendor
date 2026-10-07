import prisma from "../db.server";
import { listMarketplaceProducts } from "./products.server";
import {
  getReportPeriodRange,
  shopifyCreatedAtQuery,
  shopifyqlPeriodClause,
  type ReportPeriod,
} from "../utils/report-period";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type AnalyticsPoint = {
  label: string;
  sales: number;
  orders: number;
};

export type TopProductRow = {
  title: string;
  netSales: number;
};

export type ShopAnalytics = {
  period: ReportPeriod;
  rangeLabel: string;
  currency: string;
  source: "shopifyql" | "fallback";
  error: string | null;
  totalSales: number;
  netSales: number;
  previousTotalSales: number;
  salesChangePercent: number | null;
  orders: number;
  previousOrders: number;
  averageOrderValue: number;
  customers: number;
  returningCustomerRate: number | null;
  marketplaceRevenue: number;
  productsNew: number;
  productsActive: number;
  inventoryUnits: number;
  series: AnalyticsPoint[];
  topProducts: TopProductRow[];
};

function money(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object") {
    const obj = value as { amount?: unknown };
    if (obj.amount != null) return money(obj.amount);
  }
  // Shopify sometimes returns "1234.56", occasionally with currency junk.
  const cleaned = String(value).replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Prefer period __totals from any row; otherwise sum the timeseries column. */
function pickPeriodMetric(
  rows: Array<Record<string, unknown>>,
  totalsKey: string,
  seriesKey: string,
): number {
  for (const row of rows) {
    if (row[totalsKey] != null && row[totalsKey] !== "") {
      return money(row[totalsKey]);
    }
  }
  return rows.reduce((sum, row) => sum + money(row[seriesKey]), 0);
}

function formatSeriesLabel(raw: unknown, grain: "hour" | "day" | "month") {
  const s = String(raw || "");
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  if (grain === "hour") {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(d);
  }
  if (grain === "month") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "2-digit",
    }).format(d);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

async function runShopifyql(admin: AdminGraphql, query: string) {
  const response = await admin.graphql(
    `#graphql
    query marketplaceShopifyql($query: String!) {
      shop { currencyCode }
      shopifyqlQuery(query: $query) {
        tableData {
          columns { name dataType displayName }
          rows
        }
        parseErrors
      }
    }`,
    { variables: { query } },
  );
  const json = await response.json();
  const gqlErrors = (json.errors ?? []) as Array<{ message?: string }>;
  if (gqlErrors.length) {
    throw new Error(gqlErrors.map((e) => e.message || "ShopifyQL error").join(", "));
  }
  const payload = json.data?.shopifyqlQuery;
  const parseErrors = (payload?.parseErrors ?? []) as string[];
  if (parseErrors.length) {
    throw new Error(parseErrors.join(", "));
  }
  return {
    currency: (json.data?.shop?.currencyCode as string) || "PHP",
    rows: (payload?.tableData?.rows ?? []) as Array<Record<string, unknown>>,
  };
}

async function marketplaceSnapshot(admin: AdminGraphql, shop: string, period: ReportPeriod) {
  const { start, end } = getReportPeriodRange(period);
  const [products, market] = await Promise.all([
    listMarketplaceProducts(admin, { first: 100 }).catch(() => []),
    prisma.orderAttribution
      .findMany({
        where: { shop, createdAt: { gte: start, lte: end } },
        select: { subtotal: true, currency: true },
      })
      .catch(() => [] as Array<{ subtotal: number; currency: string }>),
  ]);

  let inventoryUnits = 0;
  let productsActive = 0;
  for (const p of products as Array<{
    status?: string;
    totalInventory?: number | null;
  }>) {
    inventoryUnits += Math.max(0, Number(p.totalInventory ?? 0));
    if (String(p.status || "").toUpperCase() === "ACTIVE") productsActive += 1;
  }

  const productQuery = shopifyCreatedAtQuery(start, end);
  let productsNew = 0;
  try {
    const response = await admin.graphql(
      `#graphql
      query marketplaceReportProducts($query: String) {
        productsCount(query: $query) { count }
      }`,
      { variables: { query: productQuery } },
    );
    const json = await response.json();
    productsNew = Number(json.data?.productsCount?.count ?? 0);
  } catch {
    productsNew = 0;
  }

  return {
    inventoryUnits,
    productsActive,
    productsNew,
    marketplaceRevenue: market.reduce((s, r) => s + r.subtotal, 0),
    currency: market[0]?.currency ?? "PHP",
  };
}

async function buildShopifyqlAnalytics(
  admin: AdminGraphql,
  period: ReportPeriod,
): Promise<Omit<ShopAnalytics, "marketplaceRevenue" | "productsNew" | "productsActive" | "inventoryUnits">> {
  const { since, timeseries, label } = shopifyqlPeriodClause(period);

  const salesQuery = [
    "FROM sales",
    "SHOW total_sales, net_sales, orders, average_order_value",
    `TIMESERIES ${timeseries}`,
    since,
    "COMPARE TO previous_period",
    "WITH TOTALS",
    `ORDER BY ${timeseries} ASC`,
  ].join(" ");

  const topQuery = [
    "FROM sales",
    "SHOW net_sales",
    "GROUP BY TOP 5 product_title",
    since,
    "ORDER BY net_sales DESC",
  ].join(" ");

  const customersQuery = [
    "FROM sales",
    "SHOW customers, returning_customers",
    since,
    "WITH TOTALS",
  ].join(" ");

  const [sales, top, customers] = await Promise.all([
    runShopifyql(admin, salesQuery),
    runShopifyql(admin, topQuery).catch(() => ({ currency: "PHP", rows: [] })),
    runShopifyql(admin, customersQuery).catch(() => ({
      currency: "PHP",
      rows: [],
    })),
  ]);

  const rows = sales.rows;
  const totalSales = pickPeriodMetric(
    rows,
    "total_sales__totals",
    "total_sales",
  );
  const netSales = pickPeriodMetric(rows, "net_sales__totals", "net_sales");
  const previousTotalSales = pickPeriodMetric(
    rows,
    "comparison_total_sales__previous_period__totals",
    "comparison_total_sales__previous_period",
  );
  const orders = pickPeriodMetric(rows, "orders__totals", "orders");
  const previousOrders = pickPeriodMetric(
    rows,
    "comparison_orders__previous_period__totals",
    "comparison_orders__previous_period",
  );
  const averageOrderValue = pickPeriodMetric(
    rows,
    "average_order_value__totals",
    "average_order_value",
  );

  const series: AnalyticsPoint[] = rows
    .filter((row) => row[timeseries] != null)
    .map((row) => ({
      label: formatSeriesLabel(row[timeseries], timeseries),
      sales: money(row.total_sales),
      orders: money(row.orders),
    }));

  // Sanity: if period total is missing/odd but we have a chart, use series sum.
  const seriesSum = series.reduce((s, p) => s + p.sales, 0);
  const resolvedTotalSales =
    rows.some((r) => r.total_sales__totals != null && r.total_sales__totals !== "")
      ? totalSales
      : seriesSum;

  const topProducts: TopProductRow[] = top.rows
    .filter((row) => row.product_title)
    .map((row) => ({
      title: String(row.product_title),
      netSales: money(row.net_sales),
    }));

  const customersCount = pickPeriodMetric(
    customers.rows,
    "customers__totals",
    "customers",
  );
  const returning = pickPeriodMetric(
    customers.rows,
    "returning_customers__totals",
    "returning_customers",
  );
  const returningCustomerRate =
    customersCount > 0 ? (returning / customersCount) * 100 : null;

  return {
    period,
    rangeLabel: label,
    currency: sales.currency,
    source: "shopifyql",
    error: null,
    totalSales: resolvedTotalSales,
    netSales,
    previousTotalSales,
    salesChangePercent: pctChange(resolvedTotalSales, previousTotalSales),
    orders,
    previousOrders,
    averageOrderValue,
    customers: customersCount,
    returningCustomerRate,
    series,
    topProducts,
  };
}

async function buildFallbackAnalytics(
  admin: AdminGraphql,
  shop: string,
  period: ReportPeriod,
  reason: string,
): Promise<ShopAnalytics> {
  const { start, end, label } = getReportPeriodRange(period);
  const query = `${shopifyCreatedAtQuery(start, end)} status:any`;
  const response = await admin.graphql(
    `#graphql
    query marketplaceFallbackAnalytics($first: Int!, $query: String) {
      shop { currencyCode }
      ordersCount(query: $query) { count }
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          email
          cancelledAt
          createdAt
          currentTotalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }`,
    { variables: { first: 100, query } },
  );
  const json = await response.json();
  const nodes = (json.data?.orders?.nodes ?? []) as Array<{
    email?: string | null;
    cancelledAt?: string | null;
    createdAt?: string;
    currentTotalPriceSet?: {
      shopMoney?: { amount?: string; currencyCode?: string };
    };
  }>;

  let totalSales = 0;
  const emails = new Set<string>();
  const byDay = new Map<string, { sales: number; orders: number }>();
  for (const order of nodes) {
    if (order.cancelledAt) continue;
    const amount = money(order.currentTotalPriceSet?.shopMoney?.amount);
    totalSales += amount;
    const email = String(order.email || "")
      .trim()
      .toLowerCase();
    if (email) emails.add(email);
    const dayKey = (order.createdAt || "").slice(0, 10) || "unknown";
    const bucket = byDay.get(dayKey) || { sales: 0, orders: 0 };
    bucket.sales += amount;
    bucket.orders += 1;
    byDay.set(dayKey, bucket);
  }

  const orders = Number(json.data?.ordersCount?.count ?? nodes.length);
  const snapshot = await marketplaceSnapshot(admin, shop, period);

  return {
    period,
    rangeLabel: label,
    currency:
      (json.data?.shop?.currencyCode as string) || snapshot.currency || "PHP",
    source: "fallback",
    error: reason,
    totalSales,
    netSales: totalSales,
    previousTotalSales: 0,
    salesChangePercent: null,
    orders,
    previousOrders: 0,
    averageOrderValue: orders > 0 ? totalSales / orders : 0,
    customers: emails.size,
    returningCustomerRate: null,
    marketplaceRevenue: snapshot.marketplaceRevenue,
    productsNew: snapshot.productsNew,
    productsActive: snapshot.productsActive,
    inventoryUnits: snapshot.inventoryUnits,
    series: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => ({
        label: formatSeriesLabel(day, "day"),
        sales: v.sales,
        orders: v.orders,
      })),
    topProducts: [],
  };
}

export async function buildShopAnalytics(
  admin: AdminGraphql,
  shop: string,
  period: ReportPeriod,
): Promise<ShopAnalytics> {
  const snapshot = await marketplaceSnapshot(admin, shop, period);

  try {
    const analytics = await buildShopifyqlAnalytics(admin, period);
    return {
      ...analytics,
      marketplaceRevenue: snapshot.marketplaceRevenue,
      productsNew: snapshot.productsNew,
      productsActive: snapshot.productsActive,
      inventoryUnits: snapshot.inventoryUnits,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Shopify analytics unavailable.";
    console.error("ShopifyQL analytics failed, using fallback", error);
    return buildFallbackAnalytics(admin, shop, period, message);
  }
}

/** Seller report (attribution-based; ShopifyQL is store-wide). */
export async function buildVendorReport(
  admin: AdminGraphql,
  shop: string,
  vendorId: string,
  period: ReportPeriod,
) {
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
      createdAt: true,
    },
  });

  const revenue = attributions.reduce((s, r) => s + r.subtotal, 0);
  const orderIds = [...new Set(attributions.map((a) => a.shopifyOrderId))];
  const currency = attributions[0]?.currency ?? "PHP";

  const emails = new Set<string>();
  await Promise.all(
    orderIds.slice(0, 40).map(async (id) => {
      try {
        const response = await admin.graphql(
          `#graphql
          query vendorReportOrderEmail($id: ID!) {
            order(id: $id) { email cancelledAt }
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
        // ignore
      }
    }),
  );

  const products = (await listMarketplaceProducts(admin, {
    vendorId,
    first: 100,
  }).catch(() => [])) as Array<{
    status?: string;
    totalInventory?: number | null;
  }>;

  let inventoryUnits = 0;
  let productsActive = 0;
  for (const p of products) {
    inventoryUnits += Math.max(0, Number(p.totalInventory ?? 0));
    if (String(p.status || "").toUpperCase() === "ACTIVE") productsActive += 1;
  }

  const byDay = new Map<string, number>();
  for (const row of attributions) {
    const key = row.createdAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + row.subtotal);
  }

  return {
    period,
    rangeLabel: label,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    revenue,
    currency,
    orderCount: orderIds.length,
    customers: emails.size,
    averageOrderValue: orderIds.length ? revenue / orderIds.length : 0,
    productsNew: productsActive,
    productsActive,
    inventoryUnits,
    marketplaceRevenue: revenue,
    series: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, sales]) => ({
        label: formatSeriesLabel(day, "day"),
        sales,
        orders: 0,
      })),
  };
}

/** @deprecated use buildShopAnalytics */
export async function buildShopReport(
  admin: AdminGraphql,
  shop: string,
  period: ReportPeriod,
) {
  const a = await buildShopAnalytics(admin, shop, period);
  return {
    period: a.period,
    rangeLabel: a.rangeLabel,
    startIso: "",
    endIso: "",
    revenue: a.totalSales,
    currency: a.currency,
    orderCount: a.orders,
    customers: a.customers,
    productsNew: a.productsNew,
    productsActive: a.productsActive,
    inventoryUnits: a.inventoryUnits,
    marketplaceRevenue: a.marketplaceRevenue,
  };
}
