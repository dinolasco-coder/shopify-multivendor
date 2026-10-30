import {
  ORDER_CUSTOMIZATION_NAMESPACE,
  ORDER_CUSTOMIZATION_NOTE_KEY,
  ORDER_CUSTOMIZATION_STATUS_KEY,
} from "../constants";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type CustomizationCustomerStatus = "pending" | "accepted" | "cancelled";

/** Write order metafields the customer account extension reads. */
export async function setOrderCustomizationCustomerNote(
  admin: AdminGraphql,
  shopifyOrderId: string,
  payload: {
    status: CustomizationCustomerStatus;
    message: string;
  },
) {
  const message = payload.message.trim().slice(0, 2000);
  if (!message) return;

  const response = await admin.graphql(
    `#graphql
    mutation setOrderCustomizationCustomerNote($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopifyOrderId,
            namespace: ORDER_CUSTOMIZATION_NAMESPACE,
            key: ORDER_CUSTOMIZATION_STATUS_KEY,
            type: "single_line_text_field",
            value: payload.status,
          },
          {
            ownerId: shopifyOrderId,
            namespace: ORDER_CUSTOMIZATION_NAMESPACE,
            key: ORDER_CUSTOMIZATION_NOTE_KEY,
            type: "multi_line_text_field",
            value: message,
          },
        ],
      },
    },
  );
  const json = await response.json();
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    console.error("setOrderCustomizationCustomerNote", errors);
  }
}
