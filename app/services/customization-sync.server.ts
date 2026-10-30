import type { OrderCustomizationInput } from "../utils/note-links";
import { extractCustomizationFromOrder } from "../utils/note-links";
import { upsertCustomizationRequest } from "../models/customization.server";

const ORDER_CUSTOMIZATION_QUERY = `#graphql
  query orderCustomizationSources($id: ID!) {
    order(id: $id) {
      id
      name
      note
      customAttributes {
        key
        value
      }
      lineItems(first: 50) {
        nodes {
          id
          customAttributes {
            key
            value
          }
        }
      }
    }
  }
`;

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function parseLineItemIds(lineItemsJson: string): string[] {
  try {
    const items = JSON.parse(lineItemsJson || "[]") as Array<{ id?: string }>;
    return items.map((i) => i.id).filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

function productTitleFromAttribution(lineItemsJson: string): string {
  try {
    const items = JSON.parse(lineItemsJson || "[]") as Array<{ title?: string }>;
    return items[0]?.title || "Product";
  } catch {
    return "Product";
  }
}

/** Fetch order sources and upsert a customization row when design URLs exist. */
export async function syncCustomizationForAttribution(
  admin: AdminGraphql,
  attr: {
    id: string;
    shop: string;
    vendorId: string;
    shopifyOrderId: string;
    shopifyOrderName?: string | null;
    lineItemsJson: string;
  },
  opts?: { notify?: boolean },
): Promise<boolean> {
  const response = await admin.graphql(ORDER_CUSTOMIZATION_QUERY, {
    variables: { id: attr.shopifyOrderId },
  });
  const json = await response.json();
  const order = json.data?.order as OrderCustomizationInput & {
    name?: string | null;
  } | null;
  if (!order) return false;

  const lineItemIds = parseLineItemIds(attr.lineItemsJson);
  const extracted = extractCustomizationFromOrder(order, { lineItemIds });
  if (!extracted) return false;

  const orderName =
    attr.shopifyOrderName || order.name || attr.shopifyOrderId;

  await upsertCustomizationRequest({
    shop: attr.shop,
    vendorId: attr.vendorId,
    attributionId: attr.id,
    shopifyOrderId: attr.shopifyOrderId,
    orderName,
    productTitle: productTitleFromAttribution(attr.lineItemsJson),
    customerNote: extracted.customerNote,
    imageUrls: extracted.imageUrls,
  });

  if (opts?.notify !== false) {
    try {
      const { notifyCustomization } = await import("../models/notifications.server");
      await notifyCustomization({
        shop: attr.shop,
        vendorId: attr.vendorId,
        orderName,
        attributionId: attr.id,
      });
    } catch (notifyError) {
      console.error("notify customization failed", notifyError);
    }
  }

  return true;
}
