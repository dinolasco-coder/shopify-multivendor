import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { attributeOrderFromWebhook } from "../services/commission.server";
import { autoPayoutForOrder } from "../services/auto-payout.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const graphqlAdmin =
      admin ?? (await unauthenticated.admin(shop)).admin;
    await attributeOrderFromWebhook(shop, payload as never, graphqlAdmin);
    console.log(`Attributed order webhook for ${shop}`);

    const order = payload as {
      admin_graphql_api_id?: string;
      id?: number | string;
      financial_status?: string;
    };
    const shopifyOrderId =
      order.admin_graphql_api_id ||
      (order.id != null ? `gid://shopify/Order/${order.id}` : null);
    // Retry auto-pay on updates (idempotent). Prefer when paid/partially_paid.
    const fin = (order.financial_status || "").toLowerCase();
    if (
      shopifyOrderId &&
      (!fin || fin === "paid" || fin === "partially_paid" || fin === "authorized")
    ) {
      const result = await autoPayoutForOrder(shop, shopifyOrderId);
      if (result.attempted > 0) {
        console.log(`PayMongo auto-payout (update) for ${shop}`, result);
      }
    }
  } catch (error) {
    console.error("Order update attribution failed", error);
  }

  return new Response();
};
