type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Creates (or finds) a custom collection for an approved vendor so
 * storefront can link to their products.
 */
export async function ensureVendorCollection(
  admin: AdminGraphql,
  vendor: { id: string; name: string; shopifyCollectionId?: string | null },
): Promise<string | null> {
  if (vendor.shopifyCollectionId) {
    return vendor.shopifyCollectionId;
  }

  const response = await admin.graphql(
    `#graphql
    mutation createVendorCollection($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id title handle }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: {
          title: `Vendor: ${vendor.name}`,
          descriptionHtml: `<p>Products from ${vendor.name}</p>`,
        },
      },
    },
  );

  const json = await response.json();
  const errors = json.data?.collectionCreate?.userErrors ?? [];
  if (errors.length) {
    console.error("collectionCreate errors", errors);
    return null;
  }
  return json.data?.collectionCreate?.collection?.id ?? null;
}
