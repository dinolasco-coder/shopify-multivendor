import type { ActionFunctionArgs } from "react-router";
import { applyPaymongoTransferStatus } from "../services/auto-payout.server";
import { parsePaymongoTransferCallback } from "../utils/paymongo-webhook-payload";

/**
 * PayMongo transfer status callback (public; no Shopify session).
 * Configure as callback_url on batch transfers.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { transferId, status, failureMessage } =
    parsePaymongoTransferCallback(body);

  if (!transferId) {
    console.warn("PayMongo webhook: no transfer id in payload", body);
  }

  try {
    await applyPaymongoTransferStatus({
      transferId,
      status,
      failureMessage,
    });
  } catch (error) {
    console.error("PayMongo webhook handler failed", error);
  }

  return new Response(null, { status: 200 });
};

export const loader = async () => {
  return new Response("PayMongo webhook", { status: 200 });
};
