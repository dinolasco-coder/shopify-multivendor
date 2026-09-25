import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { listAttributionsForVendor } from "../models/attribution.server";
import { formatMoney } from "../utils/money";
import { unauthenticated } from "../shopify.server";

type OrderStatusMap = Record<
  string,
  {
    fulfillment: string;
    financial: string;
    adminUrl: string;
  }
>;

async function fetchOrderStatuses(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  orderIds: string[],
  shop: string,
): Promise<OrderStatusMap> {
  const unique = [...new Set(orderIds)].slice(0, 40);
  const map: OrderStatusMap = {};
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");

  await Promise.all(
    unique.map(async (id) => {
      try {
        const response = await admin.graphql(
          `#graphql
          query vendorOrderStatus($id: ID!) {
            order(id: $id) {
              id
              name
              displayFulfillmentStatus
              displayFinancialStatus
            }
          }`,
          { variables: { id } },
        );
        const json = await response.json();
        const order = json.data?.order;
        if (!order) return;
        const numeric = String(order.id).split("/").pop();
        map[id] = {
          fulfillment: order.displayFulfillmentStatus || "UNFULFILLED",
          financial: order.displayFinancialStatus || "PENDING",
          adminUrl: `https://admin.shopify.com/store/${shopHandle}/orders/${numeric}`,
        };
      } catch (error) {
        console.error("vendor order status failed", id, error);
      }
    }),
  );

  return map;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const attributions = await listAttributionsForVendor(vendor.id);
  let statuses: OrderStatusMap = {};
  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    statuses = await fetchOrderStatuses(
      admin,
      attributions.map((a) => a.shopifyOrderId),
      vendor.shop,
    );
  } catch (error) {
    console.error("Failed loading order statuses for vendor", error);
  }

  return { attributions, statuses, shop: vendor.shop };
};

function labelStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export default function VendorOrders() {
  const { attributions, statuses } = useLoaderData<typeof loader>();

  return (
    <Page title="Orders">
      <BlockStack gap="400">
        <Banner tone="info">
          Fulfillment is completed in Shopify Admin (or your courier app). Use{" "}
          <strong>Open in Shopify</strong> to fulfill, then print a simple
          invoice for your records.
        </Banner>

        {attributions.length === 0 ? (
          <Card>
            <Text as="p" tone="subdued">
              No orders with your products yet.
            </Text>
          </Card>
        ) : (
          <BlockStack gap="300">
            {attributions.map((order) => {
              const items = JSON.parse(order.lineItemsJson || "[]") as Array<{
                title: string;
                quantity: number;
                price: number;
              }>;
              const status = statuses[order.shopifyOrderId];
              return (
                <Card key={order.id}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="start" wrap>
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingMd">
                          {order.shopifyOrderName || order.shopifyOrderId}
                        </Text>
                        <Text as="p" tone="subdued">
                          {new Date(order.createdAt).toLocaleString()}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100">
                        <Text as="p">
                          Total:{" "}
                          <Text as="span" fontWeight="semibold">
                            {formatMoney(order.subtotal, order.currency)}
                          </Text>
                        </Text>
                        <Text as="p" tone="subdued">
                          Commission{" "}
                          {formatMoney(order.commissionAmount, order.currency)}
                        </Text>
                      </BlockStack>
                    </InlineStack>

                    {status && (
                      <Text as="p">
                        Fulfillment:{" "}
                        <strong>{labelStatus(status.fulfillment)}</strong>
                        {" · "}
                        Payment:{" "}
                        <strong>{labelStatus(status.financial)}</strong>
                      </Text>
                    )}

                    <BlockStack gap="100">
                      {items.map((item, index) => (
                        <Text as="p" key={`${order.id}-${index}`}>
                          {item.title} × {item.quantity} @{" "}
                          {formatMoney(item.price, order.currency)}
                        </Text>
                      ))}
                    </BlockStack>

                    <InlineStack gap="300">
                      {status?.adminUrl && (
                        <Button url={status.adminUrl} target="_blank">
                          Open in Shopify to fulfill
                        </Button>
                      )}
                      <Button url={`/vendor/invoice/${order.id}`} target="_blank">
                        Print invoice
                      </Button>
                      <Link to={`/vendor/invoice/${order.id}`}>View invoice</Link>
                    </InlineStack>
                  </BlockStack>
                </Card>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>
    </Page>
  );
}
