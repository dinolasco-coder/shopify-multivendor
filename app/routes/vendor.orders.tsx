import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  BlockStack,
  Card,
  Page,
  ResourceItem,
  ResourceList,
  Text,
} from "@shopify/polaris";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { listAttributionsForVendor } from "../models/attribution.server";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const attributions = await listAttributionsForVendor(result.vendor.id);
  return { attributions };
};

export default function VendorOrders() {
  const { attributions } = useLoaderData<typeof loader>();

  return (
    <Page title="Orders">
      <Card padding="0">
        {attributions.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Text as="p" tone="subdued">
              No orders with your products yet.
            </Text>
          </div>
        ) : (
          <ResourceList
            resourceName={{ singular: "order", plural: "orders" }}
            items={attributions.map((order) => {
              const items = JSON.parse(order.lineItemsJson || "[]") as Array<{
                title: string;
                quantity: number;
                price: number;
              }>;
              return {
                id: order.id,
                name: order.shopifyOrderName || order.shopifyOrderId,
                meta: `${formatMoney(order.subtotal, order.currency)} · Commission ${formatMoney(order.commissionAmount, order.currency)} · ${new Date(order.createdAt).toLocaleString()}`,
                lines: items
                  .map(
                    (item) =>
                      `${item.title} × ${item.quantity} @ ${formatMoney(item.price, order.currency)}`,
                  )
                  .join(" · "),
              };
            })}
            renderItem={(item) => (
              <ResourceItem id={item.id} onClick={() => undefined}>
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {item.name}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {item.meta}
                  </Text>
                  {item.lines && (
                    <Text as="span" variant="bodySm">
                      {item.lines}
                    </Text>
                  )}
                </BlockStack>
              </ResourceItem>
            )}
          />
        )}
      </Card>
    </Page>
  );
}
