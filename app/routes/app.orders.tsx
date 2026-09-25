import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listAttributionsForShop } from "../models/attribution.server";
import { syncRecentOrders } from "../services/commission.server";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Local tunnels often miss order webhooks; keep attributions fresh when opening this page.
  let syncError: string | null = null;
  try {
    await syncRecentOrders(session.shop, admin, 15);
  } catch (error) {
    console.error("Auto order sync failed", error);
    syncError =
      error instanceof Error ? error.message : "Failed to sync recent orders.";
  }

  const attributions = await listAttributionsForShop(session.shop);
  return { attributions, syncError };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "sync") {
    return { error: "Unknown action." };
  }

  try {
    const result = await syncRecentOrders(session.shop, admin);
    return {
      ok: true,
      message: `Synced ${result.processed} recent order(s) from Shopify.`,
    };
  } catch (error) {
    console.error("Order sync failed", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to sync orders. Check read_orders scope / protected customer data.",
    };
  }
};

export default function AdminOrdersPage() {
  const { attributions, syncError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  // Group by order for display
  const byOrder = new Map<
    string,
    {
      name: string | null;
      currency: string;
      vendors: typeof attributions;
      subtotal: number;
      commission: number;
    }
  >();

  for (const row of attributions) {
    const entry = byOrder.get(row.shopifyOrderId) ?? {
      name: row.shopifyOrderName,
      currency: row.currency,
      vendors: [],
      subtotal: 0,
      commission: 0,
    };
    entry.vendors.push(row);
    entry.subtotal += row.subtotal;
    entry.commission += row.commissionAmount;
    byOrder.set(row.shopifyOrderId, entry);
  }

  const orders = Array.from(byOrder.entries());

  return (
    <s-page heading="Orders & commissions">
      <s-section heading="Sync">
        <s-paragraph>
          This page auto-syncs recent Shopify orders when you open it. Use the
          button to refresh without leaving. Automatic webhooks also work when
          the CLI shows ORDERS_CREATE after checkout (requires a full{" "}
          <s-text type="strong">npm run dev</s-text> restart after enabling
          them).
        </s-paragraph>
        {syncError && <s-banner tone="critical">{syncError}</s-banner>}
        {actionData && "error" in actionData && actionData.error && (
          <s-banner tone="critical">{actionData.error}</s-banner>
        )}
        {actionData && "message" in actionData && actionData.message && (
          <s-banner tone="success">{actionData.message}</s-banner>
        )}
        <Form method="post">
          <input type="hidden" name="intent" value="sync" />
          <s-button type="submit" {...(busy ? { loading: true } : {})}>
            {busy ? "Syncing…" : "Sync recent orders"}
          </s-button>
        </Form>
      </s-section>

      <s-section heading="Attributed marketplace orders">
        {orders.length === 0 ? (
          <s-paragraph>
            No attributed orders yet. Place a checkout, then open this page
            again (it auto-syncs) or click <s-text type="strong">Sync recent
            orders</s-text>.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {orders.map(([orderId, order]) => (
              <s-box
                key={orderId}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="base">
                  <s-heading>
                    {order.name || orderId} ·{" "}
                    {formatMoney(order.subtotal, order.currency)}
                  </s-heading>
                  <s-paragraph>
                    Platform commission:{" "}
                    {formatMoney(order.commission, order.currency)}
                  </s-paragraph>
                  <s-unordered-list>
                    {order.vendors.map((v) => (
                      <s-list-item key={v.id}>
                        {v.vendor.name}: {formatMoney(v.subtotal, v.currency)}{" "}
                        (commission {formatMoney(v.commissionAmount, v.currency)}
                        )
                      </s-list-item>
                    ))}
                  </s-unordered-list>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
