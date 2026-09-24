import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { attributeOrderFromWebhook } from "../services/commission.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const graphqlAdmin =
      admin ?? (await unauthenticated.admin(shop)).admin;
    await attributeOrderFromWebhook(shop, payload as never, graphqlAdmin);
    console.log(`Attributed order webhook for ${shop}`);
  } catch (error) {
    console.error("Order create attribution failed", error);
  }

  return new Response();
};
