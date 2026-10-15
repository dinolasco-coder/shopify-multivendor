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
    };
    const shopifyOrderId =
      order.admin_graphql_api_id ||
      (order.id != null ? `gid://shopify/Order/${order.id}` : null);
    if (shopifyOrderId) {
      const result = await autoPayoutForOrder(shop, shopifyOrderId);
      if (result.attempted > 0) {
        console.log(`PayMongo auto-payout for ${shop}`, result);
      }
    }
  } catch (error) {
    console.error("Order create attribution failed", error);
  }

  return new Response();
};
