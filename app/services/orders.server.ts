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

  const response = await admin.graphql(
    `#graphql
    mutation marketplaceOrderCancel(
      $orderId: ID!
      $reason: OrderCancelReason!
      $restock: Boolean!
      $notifyCustomer: Boolean
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
        restock: input.restock !== false,
        notifyCustomer: input.notifyCustomer !== false,
        refundMethod: {
          originalPaymentMethodsRefund: input.refund !== false,
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

  return payload?.job ?? null;
}
