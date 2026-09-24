import {
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

export function vendorMetafieldInput(vendorId: string) {
  return {
    namespace: VENDOR_METAFIELD_NAMESPACE,
    key: VENDOR_METAFIELD_KEY,
    type: "single_line_text_field",
    value: vendorId,
  };
}

export { VENDOR_METAFIELD_NAMESPACE_APP, VENDOR_METAFIELD_KEY };
