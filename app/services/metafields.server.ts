import {
  AI_CUSTOMIZATION_FEE_KEY,
  AI_CUSTOMIZATION_FEE_NAMESPACE,
  AI_CUSTOMIZATION_FEE_TYPE,
  ORDER_CUSTOMIZATION_NAMESPACE,
  ORDER_CUSTOMIZATION_NOTE_KEY,
  ORDER_CUSTOMIZATION_STATUS_KEY,
  VENDOR_METAFIELD_KEY,
  VENDOR_METAFIELD_NAMESPACE,
  VENDOR_METAFIELD_NAMESPACE_APP,
} from "../constants";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function ensureMarketplaceMetafieldDefinition(admin: AdminGraphql) {
  const response = await admin.graphql(
    `#graphql
    mutation CreateVendorMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id name }
        userErrors { field message code }
      }
    }`,
    {
      variables: {
        definition: {
          name: "Marketplace Vendor ID",
          namespace: VENDOR_METAFIELD_NAMESPACE,
          key: VENDOR_METAFIELD_KEY,
          description: "Links a product to a marketplace vendor",
          type: "single_line_text_field",
          ownerType: "PRODUCT",
          access: {
            storefront: "PUBLIC_READ",
          },
        },
      },
    },
  );

  const json = await response.json();
  const errors = json.data?.metafieldDefinitionCreate?.userErrors ?? [];
  // Ignore "already taken" style errors on reinstall
  const realErrors = errors.filter(
    (e: { message?: string; code?: string }) =>
      !String(e.message || "")
        .toLowerCase()
        .includes("taken") &&
      e.code !== "TAKEN",
  );
  if (realErrors.length) {
    console.error("metafieldDefinitionCreate errors", realErrors);
  }
  return json;
}

async function createOrderMetafieldDefinition(
  admin: AdminGraphql,
  definition: {
    name: string;
    key: string;
    description: string;
    type: string;
  },
) {
  const response = await admin.graphql(
    `#graphql
    mutation CreateOrderMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id name }
        userErrors { field message code }
      }
    }`,
    {
      variables: {
        definition: {
          ...definition,
          namespace: ORDER_CUSTOMIZATION_NAMESPACE,
          ownerType: "ORDER",
          access: {
            customerAccount: "PUBLIC_READ",
          },
        },
      },
    },
  );
  const json = await response.json();
  const errors = json.data?.metafieldDefinitionCreate?.userErrors ?? [];
  const realErrors = errors.filter(
    (e: { message?: string; code?: string }) =>
      !String(e.message || "")
        .toLowerCase()
        .includes("taken") &&
      e.code !== "TAKEN",
  );
  if (realErrors.length) {
    console.error("order metafieldDefinitionCreate errors", realErrors);
  }
}

export async function ensureOrderCustomizationMetafieldDefinitions(
  admin: AdminGraphql,
) {
  await createOrderMetafieldDefinition(admin, {
    name: "Customization status",
    key: ORDER_CUSTOMIZATION_STATUS_KEY,
    description: "AI customization status for customer account",
    type: "single_line_text_field",
  });
  await createOrderMetafieldDefinition(admin, {
    name: "Customization message",
    key: ORDER_CUSTOMIZATION_NOTE_KEY,
    description: "Message to customer about customization or cancellation",
    type: "multi_line_text_field",
  });
}

export function vendorMetafieldInput(vendorId: string) {
  return {
    namespace: VENDOR_METAFIELD_NAMESPACE,
    key: VENDOR_METAFIELD_KEY,
    type: "single_line_text_field",
    value: vendorId,
  };
}

export function aiCustomizationFeeMetafieldInput(fee: string) {
  return {
    namespace: AI_CUSTOMIZATION_FEE_NAMESPACE,
    key: AI_CUSTOMIZATION_FEE_KEY,
    type: AI_CUSTOMIZATION_FEE_TYPE,
    value: fee,
  };
}

export { VENDOR_METAFIELD_NAMESPACE_APP, VENDOR_METAFIELD_KEY };
