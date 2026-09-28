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
  vendor: {
    id: string;
    name: string;
    slug?: string | null;
    shopifyCollectionId?: string | null;
  },
): Promise<{ id: string; handle: string } | null> {
  if (vendor.shopifyCollectionId) {
    try {
      const existing = await admin.graphql(
        `#graphql
        query vendorCollection($id: ID!) {
          collection(id: $id) { id handle }
        }`,
        { variables: { id: vendor.shopifyCollectionId } },
      );
      const json = await existing.json();
      const col = json.data?.collection;
      if (col?.id) {
        return { id: col.id, handle: col.handle };
      }
    } catch {
      // recreate below
    }
  }

  const handleBase = `seller-${(vendor.slug || vendor.id).toLowerCase()}`.slice(
    0,
    50,
  );

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
          title: vendor.name,
          handle: handleBase,
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
  const collection = json.data?.collectionCreate?.collection;
  if (!collection?.id) return null;
  return { id: collection.id, handle: collection.handle };
}
