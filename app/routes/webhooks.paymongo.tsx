import type { ActionFunctionArgs } from "react-router";
import { applyPaymongoTransferStatus } from "../services/auto-payout.server";

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

  const data = body as {
    data?: {
      id?: string;
      type?: string;
      attributes?: {
        status?: string;
        failure_code?: string | null;
        failure_message?: string | null;
      };
      status?: string;
    };
    id?: string;
    status?: string;
    failure_message?: string | null;
  };

  const transferId =
    data.data?.id ||
    data.id ||
    null;
  const status =
    data.data?.attributes?.status ||
    data.data?.status ||
    data.status ||
    null;
  const failureMessage =
    data.data?.attributes?.failure_message ||
    data.data?.attributes?.failure_code ||
    data.failure_message ||
    null;

  try {
    await applyPaymongoTransferStatus({
      transferId,
      status,
      failureMessage: failureMessage ? String(failureMessage) : null,
    });
  } catch (error) {
    console.error("PayMongo webhook handler failed", error);
  }

  return new Response(null, { status: 200 });
};

export const loader = async () => {
  return new Response("PayMongo webhook", { status: 200 });
};
