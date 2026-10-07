import {
  ORDER_CANCEL_REASONS,
  type OrderCancelReason,
} from "../utils/order-cancel";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Cancel a Shopify order the same way Admin does (refund / restock / notify).
 */
export async function cancelShopifyOrder(
  admin: AdminGraphql,
  input: {
    orderId: string;
    reason: OrderCancelReason;
    restock?: boolean;
    refund?: boolean;
    notifyCustomer?: boolean;
    staffNote?: string | null;
  },
) {
  const reason = ORDER_CANCEL_REASONS.some((r) => r.value === input.reason)
    ? input.reason
    : "OTHER";
  const restock = input.restock !== false;
  const refund = input.refund !== false;
  // Default ON — cancellation email should go out unless explicitly disabled.
  const notifyCustomer = input.notifyCustomer !== false;

  const orderLookup = await admin.graphql(
    `#graphql
    query marketplaceOrderEmail($id: ID!) {
      order(id: $id) {
        id
        name
        email
        cancelledAt
      }
    }`,
    { variables: { id: input.orderId } },
  );
  const orderJson = await orderLookup.json();
  if (orderJson.errors?.length) {
    throw new Error(
      orderJson.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }
  const order = orderJson.data?.order as
    | {
        id?: string;
        name?: string;
        email?: string | null;
        cancelledAt?: string | null;
      }
    | null
    | undefined;

  if (!order?.id) {
    throw new Error("Order not found.");
  }
  if (order.cancelledAt) {
    throw new Error("This order is already cancelled.");
  }

  const customerEmail = String(order.email || "").trim();

  const response = await admin.graphql(
    `#graphql
    mutation marketplaceOrderCancel(
      $orderId: ID!
      $reason: OrderCancelReason!
      $restock: Boolean!
      $notifyCustomer: Boolean!
      $refundMethod: OrderCancelRefundMethodInput!
      $staffNote: String
    ) {
      orderCancel(
        orderId: $orderId
        reason: $reason
        restock: $restock
        notifyCustomer: $notifyCustomer
        refundMethod: $refundMethod
        staffNote: $staffNote
      ) {
        job { id done }
        orderCancelUserErrors { field message code }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        orderId: input.orderId,
        reason,
        restock,
        notifyCustomer,
        refundMethod: {
          originalPaymentMethodsRefund: refund,
        },
        staffNote: input.staffNote?.trim() || null,
      },
    },
  );

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(
      json.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }

  const payload = json.data?.orderCancel;
  const errors = [
    ...(payload?.orderCancelUserErrors ?? []),
    ...(payload?.userErrors ?? []),
  ] as Array<{ message?: string }>;
  if (errors.length) {
    throw new Error(
      errors.map((e) => e.message || "Cancel failed").join(", "),
    );
  }

  return {
    job: payload?.job ?? null,
    orderName: order.name || null,
    customerEmail: customerEmail || null,
    notified: notifyCustomer && Boolean(customerEmail),
  };
}
