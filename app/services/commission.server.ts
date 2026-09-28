import { getVendorById } from "../models/vendor.server";
import { upsertOrderAttributions } from "../models/attribution.server";
import {
  VENDOR_METAFIELD_KEY,
  VENDOR_METAFIELD_NAMESPACE,
} from "../constants";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ShopifyWebhookLineItem = {
  id: number | string;
  product_id?: number | string | null;
  title?: string;
  quantity?: number;
  price?: string;
  admin_graphql_api_id?: string;
};

type ShopifyWebhookOrder = {
  id: number | string;
  name?: string;
  admin_graphql_api_id?: string;
  currency?: string;
  line_items?: ShopifyWebhookLineItem[];
};

function money(value: string | number | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function attributeOrderFromWebhook(
  shop: string,
  order: ShopifyWebhookOrder,
  admin: AdminGraphql,
) {
  const lineItems = order.line_items ?? [];
  if (!lineItems.length) return;

  const shopifyOrderId =
    order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`;
  const currency = order.currency || "USD";

  // Group line items by product, then resolve vendor metafield
  const byVendor = new Map<
    string,
    {
      lineItemIds: string[];
      lineItems: Array<{
        id: string;
        title: string;
        quantity: number;
        price: number;
      }>;
      subtotal: number;
    }
  >();

  for (const item of lineItems) {
    if (!item.product_id) continue;

    const productGid = `gid://shopify/Product/${item.product_id}`;
    const vendorId = await fetchProductVendorId(admin, productGid);
    if (!vendorId) continue;

    const lineId =
      item.admin_graphql_api_id || `gid://shopify/LineItem/${item.id}`;
    const qty = item.quantity ?? 1;
    const price = money(item.price);
    const lineTotal = qty * price;

    const bucket = byVendor.get(vendorId) ?? {
      lineItemIds: [],
      lineItems: [],
      subtotal: 0,
    };
    bucket.lineItemIds.push(lineId);
    bucket.lineItems.push({
      id: lineId,
      title: item.title || "Item",
      quantity: qty,
      price,
    });
    bucket.subtotal += lineTotal;
    byVendor.set(vendorId, bucket);
  }

  const attributions = [];
  for (const [vendorId, bucket] of byVendor.entries()) {
    const vendor = await getVendorById(vendorId);
    if (!vendor || vendor.shop !== shop) continue;

    const commissionAmount =
      Math.round(bucket.subtotal * (vendor.commissionPercent / 100) * 100) /
      100;

    attributions.push({
      shop,
      shopifyOrderId,
      shopifyOrderName: order.name ?? null,
      vendorId,
      lineItemIds: bucket.lineItemIds,
      lineItemsJson: bucket.lineItems,
      subtotal: Math.round(bucket.subtotal * 100) / 100,
      commissionAmount,
      currency,
    });
  }

  if (attributions.length) {
    await upsertOrderAttributions(attributions);
  }
}

async function fetchProductVendorId(
  admin: AdminGraphql,
  productId: string,
): Promise<string | null> {
  try {
    const response = await admin.graphql(
      `#graphql
      query orderProductVendor($id: ID!) {
        product(id: $id) {
          metafield(namespace: "${VENDOR_METAFIELD_NAMESPACE}", key: "${VENDOR_METAFIELD_KEY}") {
            value
          }
        }
      }`,
      { variables: { id: productId } },
    );
    const json = await response.json();
    return json.data?.product?.metafield?.value ?? null;
  } catch (error) {
    console.error("Failed to resolve product vendor", productId, error);
    return null;
  }
}

function gidNumericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const id = gid.split("/").pop();
  return id || null;
}

/**
 * Pull recent Shopify orders via Admin API and attribute vendor line items.
 * Use while order webhooks are blocked pending Protected Customer Data access.
 */
export async function syncRecentOrders(
  shop: string,
  admin: AdminGraphql,
  first = 25,
) {
  const response = await admin.graphql(
    `#graphql
    query marketplaceRecentOrders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          currencyCode
          lineItems(first: 50) {
            nodes {
              id
              title
              quantity
              originalUnitPriceSet {
                shopMoney { amount }
              }
              product { id }
            }
          }
        }
      }
    }`,
    { variables: { first } },
  );
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join(", "));
  }

  const orders = json.data?.orders?.nodes ?? [];
  let processed = 0;

  for (const order of orders) {
    const payload: ShopifyWebhookOrder = {
      id: gidNumericId(order.id) ?? order.id,
      name: order.name,
      admin_graphql_api_id: order.id,
      currency: order.currencyCode,
      line_items: (order.lineItems?.nodes ?? []).map(
        (li: {
          id: string;
          title?: string;
          quantity?: number;
          originalUnitPriceSet?: { shopMoney?: { amount?: string } };
          product?: { id?: string } | null;
        }) => ({
          id: gidNumericId(li.id) ?? li.id,
          admin_graphql_api_id: li.id,
          title: li.title,
          quantity: li.quantity,
          price: li.originalUnitPriceSet?.shopMoney?.amount,
          product_id: gidNumericId(li.product?.id),
        }),
      ),
    };

    await attributeOrderFromWebhook(shop, payload, admin);
    processed += 1;
  }

  return { processed };
}
