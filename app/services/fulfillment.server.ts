type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Fulfill only this seller's unfulfilled line items on a Shopify order.
 * Optional tracking number is attached when provided.
 */
export async function fulfillVendorLineItems(
  admin: AdminGraphql,
  input: {
    shopifyOrderId: string;
    lineItemIds: string[];
    trackingNumber?: string | null;
    trackingCompany?: string | null;
    notifyCustomer?: boolean;
  },
) {
  const wanted = new Set(input.lineItemIds.filter(Boolean));
  if (!wanted.size) {
    throw new Error("No seller line items found on this order.");
  }

  const foResponse = await admin.graphql(
    `#graphql
    query vendorFulfillmentOrders($id: ID!) {
      order(id: $id) {
        id
        fulfillmentOrders(first: 20) {
          nodes {
            id
            status
            lineItems(first: 50) {
              nodes {
                id
                remainingQuantity
                lineItem { id }
              }
            }
          }
        }
      }
    }`,
    { variables: { id: input.shopifyOrderId } },
  );
  const foJson = await foResponse.json();
  if (foJson.errors?.length) {
    throw new Error(
      foJson.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }

  const fulfillmentOrders =
    foJson.data?.order?.fulfillmentOrders?.nodes ?? [];

  const lineItemsByFulfillmentOrder: Array<{
    fulfillmentOrderId: string;
    fulfillmentOrderLineItems: Array<{ id: string; quantity: number }>;
  }> = [];

  for (const fo of fulfillmentOrders) {
    const status = String(fo.status || "").toUpperCase();
    if (status === "CLOSED" || status === "CANCELLED") continue;

    const items: Array<{ id: string; quantity: number }> = [];
    for (const li of fo.lineItems?.nodes ?? []) {
      const orderLineId = li?.lineItem?.id as string | undefined;
      const remaining = Number(li?.remainingQuantity ?? 0);
      if (!orderLineId || !wanted.has(orderLineId) || remaining <= 0) continue;
      items.push({ id: li.id, quantity: remaining });
    }
    if (items.length) {
      lineItemsByFulfillmentOrder.push({
        fulfillmentOrderId: fo.id,
        fulfillmentOrderLineItems: items,
      });
    }
  }

  if (!lineItemsByFulfillmentOrder.length) {
    throw new Error(
      "Nothing left to fulfill for your products on this order (already fulfilled or not assigned).",
    );
  }

  const trackingNumber = (input.trackingNumber || "").trim();
  const trackingCompany = (input.trackingCompany || "").trim();

  const fulfillment: Record<string, unknown> = {
    notifyCustomer: input.notifyCustomer !== false,
    lineItemsByFulfillmentOrder,
  };
  if (trackingNumber) {
    fulfillment.trackingInfo = {
      number: trackingNumber,
      ...(trackingCompany ? { company: trackingCompany } : {}),
    };
  }

  const createResponse = await admin.graphql(
    `#graphql
    mutation vendorFulfillmentCreate($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }`,
    { variables: { fulfillment } },
  );
  const createJson = await createResponse.json();
  if (createJson.errors?.length) {
    throw new Error(
      createJson.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }
  const userErrors = createJson.data?.fulfillmentCreate?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(
      userErrors.map((e: { message: string }) => e.message).join(", "),
    );
  }
  if (!createJson.data?.fulfillmentCreate?.fulfillment?.id) {
    throw new Error("Shopify did not create the fulfillment.");
  }

  return createJson.data.fulfillmentCreate.fulfillment;
}
