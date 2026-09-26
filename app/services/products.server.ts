import {
  VENDOR_METAFIELD_KEY,
  VENDOR_METAFIELD_NAMESPACE,
} from "../constants";
import { vendorMetafieldInput } from "./metafields.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function createVendorProduct(
  admin: AdminGraphql,
  input: {
    vendorId: string;
    vendorName: string;
    title: string;
    descriptionHtml?: string;
    price: string;
    inventoryQuantity: number;
    status?: "ACTIVE" | "DRAFT";
    images?: File[];
  },
) {
  const createResponse = await admin.graphql(
    `#graphql
    mutation marketplaceProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          title
          status
          handle
          vendor
          variants(first: 1) {
            nodes { id inventoryItem { id } }
          }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        product: {
          title: input.title,
          descriptionHtml: input.descriptionHtml || "",
          status: input.status ?? "ACTIVE",
          vendor: input.vendorName,
          metafields: [vendorMetafieldInput(input.vendorId)],
        },
      },
    },
  );

  const createJson = await createResponse.json();
  const userErrors = createJson.data?.productCreate?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(userErrors.map((e: { message: string }) => e.message).join(", "));
  }

  const product = createJson.data?.productCreate?.product;
  if (!product) throw new Error("Failed to create product");

  const variant = product.variants?.nodes?.[0];
  if (variant?.id) {
    await admin.graphql(
      `#graphql
      mutation marketplaceVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          productId: product.id,
          variants: [
            {
              id: variant.id,
              price: input.price,
            },
          ],
        },
      },
    );

    if (variant.inventoryItem?.id && input.inventoryQuantity >= 0) {
      await setInventoryQuantity(
        admin,
        variant.inventoryItem.id,
        input.inventoryQuantity,
      );
    }
  }

  if (input.images?.length) {
    await attachProductImages(admin, product.id, input.images);
  }

  await publishProductToOnlineStore(admin, product.id);
  await setProductVendorMetafield(admin, product.id, input.vendorId);

  return product;
}

/** Stage + upload images, then attach them to a product. */
export async function attachProductImages(
  admin: AdminGraphql,
  productId: string,
  files: File[],
) {
  const imageFiles = files.filter(
    (f) => f.size > 0 && (f.type.startsWith("image/") || !f.type),
  );
  if (!imageFiles.length) return;

  const stagedResponse = await admin.graphql(
    `#graphql
    mutation marketplaceStagedUploads($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: imageFiles.map((file) => ({
          filename: file.name || "product-image.jpg",
          mimeType: file.type || "image/jpeg",
          httpMethod: "POST",
          resource: "PRODUCT_IMAGE",
          fileSize: String(file.size),
        })),
      },
    },
  );
  const stagedJson = await stagedResponse.json();
  const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors ?? [];
  if (stagedErrors.length) {
    throw new Error(
      stagedErrors.map((e: { message: string }) => e.message).join(", "),
    );
  }

  const targets = stagedJson.data?.stagedUploadsCreate?.stagedTargets ?? [];
  if (targets.length !== imageFiles.length) {
    throw new Error("Failed to prepare image uploads.");
  }

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    const target = targets[i];
    const body = new FormData();
    for (const param of target.parameters ?? []) {
      body.append(param.name, param.value);
    }
    body.append("file", file, file.name || "product-image.jpg");

    const uploadRes = await fetch(target.url, { method: "POST", body });
    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "");
      throw new Error(
        `Image upload failed (${uploadRes.status})${text ? `: ${text}` : ""}`,
      );
    }
  }

  const mediaResponse = await admin.graphql(
    `#graphql
    mutation marketplaceProductCreateMedia(
      $productId: ID!
      $media: [CreateMediaInput!]!
    ) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id status alt }
        mediaUserErrors { field message }
      }
    }`,
    {
      variables: {
        productId,
        media: targets.map(
          (
            target: { resourceUrl: string },
            index: number,
          ) => ({
            mediaContentType: "IMAGE",
            originalSource: target.resourceUrl,
            alt: imageFiles[index]?.name || "Product image",
          }),
        ),
      },
    },
  );
  const mediaJson = await mediaResponse.json();
  const mediaErrors = mediaJson.data?.productCreateMedia?.mediaUserErrors ?? [];
  if (mediaErrors.length) {
    throw new Error(
      mediaErrors.map((e: { message: string }) => e.message).join(", "),
    );
  }
}

export async function updateVendorProduct(
  admin: AdminGraphql,
  input: {
    productId: string;
    vendorId: string;
    title: string;
    descriptionHtml?: string;
    price?: string;
    status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
    variantId?: string;
    inventoryItemId?: string;
    inventoryQuantity?: number;
  },
) {
  const updateResponse = await admin.graphql(
    `#graphql
    mutation marketplaceProductUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id title status }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        product: {
          id: input.productId,
          title: input.title,
          descriptionHtml: input.descriptionHtml || "",
          status: input.status,
        },
      },
    },
  );

  const updateJson = await updateResponse.json();
  const userErrors = updateJson.data?.productUpdate?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(userErrors.map((e: { message: string }) => e.message).join(", "));
  }

  if (input.variantId && input.price) {
    await admin.graphql(
      `#graphql
      mutation marketplaceVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          productId: input.productId,
          variants: [{ id: input.variantId, price: input.price }],
        },
      },
    );
  }

  if (typeof input.inventoryQuantity === "number" && input.inventoryQuantity >= 0) {
    if (!input.inventoryItemId) {
      throw new Error(
        "Could not find this product's inventory item. Open it in Shopify Admin and enable inventory tracking, then try again.",
      );
    }
    await setInventoryQuantity(
      admin,
      input.inventoryItemId,
      input.inventoryQuantity,
    );
  }

  await setProductVendorMetafield(admin, input.productId, input.vendorId);

  return updateJson.data?.productUpdate?.product;
}

export async function deleteVendorProduct(
  admin: AdminGraphql,
  productId: string,
) {
  const response = await admin.graphql(
    `#graphql
    mutation marketplaceProductDelete($input: ProductDeleteInput!) {
      productDelete(input: $input) {
        deletedProductId
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: { id: productId },
      },
    },
  );
  const json = await response.json();
  const userErrors = json.data?.productDelete?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(userErrors.map((e: { message: string }) => e.message).join(", "));
  }
  if (!json.data?.productDelete?.deletedProductId) {
    throw new Error("Failed to delete product.");
  }
}

/** Always write marketplace.vendor_id (create + updates + backfill). */
export async function setProductVendorMetafield(
  admin: AdminGraphql,
  productId: string,
  vendorId: string,
) {
  const response = await admin.graphql(
    `#graphql
    mutation marketplaceSetVendorMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value }
        userErrors { field message code }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: VENDOR_METAFIELD_NAMESPACE,
            key: VENDOR_METAFIELD_KEY,
            type: "single_line_text_field",
            value: vendorId,
          },
        ],
      },
    },
  );
  const json = await response.json();
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(
      errors.map((e: { message: string }) => e.message).join(", "),
    );
  }
}

/**
 * Backfill marketplace.vendor_id on products that have this seller's native
 * vendor name but are missing the metafield (so commission can attribute).
 */
export async function ensureVendorMetafieldsForVendor(
  admin: AdminGraphql,
  vendorId: string,
  vendorName: string,
) {
  const escaped = vendorName.replace(/"/g, '\\"');
  const response = await admin.graphql(
    `#graphql
    query marketplaceProductsByVendorName($query: String!, $first: Int!) {
      products(first: $first, query: $query) {
        nodes {
          id
          vendor
          metafield(namespace: "${VENDOR_METAFIELD_NAMESPACE}", key: "${VENDOR_METAFIELD_KEY}") {
            value
          }
        }
      }
    }`,
    {
      variables: {
        query: `vendor:"${escaped}"`,
        first: 50,
      },
    },
  );
  const json = await response.json();
  const products = json.data?.products?.nodes ?? [];
  let fixed = 0;

  for (const product of products) {
    if (product.metafield?.value === vendorId) continue;
    await setProductVendorMetafield(admin, product.id, vendorId);
    fixed += 1;
  }

  return { checked: products.length, fixed };
}

async function publishProductToOnlineStore(
  admin: AdminGraphql,
  productId: string,
) {
  const pubsResponse = await admin.graphql(
    `#graphql
    query marketplacePublications {
      publications(first: 20) {
        nodes {
          id
          name
        }
      }
    }`,
  );
  const pubsJson = await pubsResponse.json();
  const publications = pubsJson.data?.publications?.nodes ?? [];
  const onlineStore =
    publications.find(
      (p: { name?: string }) =>
        /online store/i.test(p.name ?? "") || p.name === "Online Store",
    ) ?? null;

  if (!onlineStore?.id) {
    console.error(
      "Could not find Online Store publication; product left unpublished",
      publications.map((p: { name?: string }) => p.name),
    );
    return;
  }

  const publishResponse = await admin.graphql(
    `#graphql
    mutation marketplacePublishProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        id: productId,
        input: [{ publicationId: onlineStore.id }],
      },
    },
  );
  const publishJson = await publishResponse.json();
  const errors = publishJson.data?.publishablePublish?.userErrors ?? [];
  if (errors.length) {
    console.error("publishablePublish errors", errors);
  }
}

async function resolveInventoryLocation(admin: AdminGraphql): Promise<{
  id: string;
  name?: string;
}> {
  const preferredName = (process.env.VENDOR_INVENTORY_LOCATION_NAME || "")
    .trim()
    .toLowerCase();
  const preferredId = (process.env.VENDOR_INVENTORY_LOCATION_ID || "").trim();

  // `location` with no id = shop default / primary location (Settings → Locations).
  const locResponse = await admin.graphql(
    `#graphql
    query marketplaceInventoryLocations {
      defaultLocation: location {
        id
        name
        isActive
        fulfillsOnlineOrders
      }
      locations(first: 20) {
        nodes {
          id
          name
          isActive
          fulfillsOnlineOrders
        }
      }
    }`,
  );
  const locJson = await locResponse.json();
  if (locJson.errors?.length) {
    throw new Error(
      locJson.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }

  const locations: Array<{
    id: string;
    name?: string;
    isActive?: boolean;
    fulfillsOnlineOrders?: boolean;
  }> = locJson.data?.locations?.nodes ?? [];
  const active = locations.filter((l) => l.isActive !== false);
  const defaultLocation = locJson.data?.defaultLocation as
    | { id: string; name?: string; isActive?: boolean; fulfillsOnlineOrders?: boolean }
    | null
    | undefined;

  const primary =
    (preferredId && active.find((l) => l.id === preferredId)) ||
    (preferredName &&
      active.find((l) => (l.name || "").toLowerCase().includes(preferredName))) ||
    (defaultLocation?.isActive !== false &&
      defaultLocation?.fulfillsOnlineOrders &&
      defaultLocation) ||
    active.find((l) => l.fulfillsOnlineOrders) ||
    (defaultLocation?.isActive !== false && defaultLocation) ||
    active[0] ||
    locations[0];

  if (!primary?.id) {
    throw new Error(
      "No active shop location found to store inventory. Add a location in Shopify Admin → Settings → Locations.",
    );
  }
  return primary;
}

async function setInventoryQuantity(
  admin: AdminGraphql,
  inventoryItemId: string,
  quantity: number,
) {
  const primary = await resolveInventoryLocation(admin);

  // Only locations where this item is already stocked — never set qty on
  // unactivated locations (that fails the whole mutation and leaves stock at 0).
  const levelsResponse = await admin.graphql(
    `#graphql
    query marketplaceInventoryLevels($id: ID!) {
      inventoryItem(id: $id) {
        inventoryLevels(first: 20) {
          nodes {
            location { id }
          }
        }
      }
    }`,
    { variables: { id: inventoryItemId } },
  );
  const levelsJson = await levelsResponse.json();
  if (levelsJson.errors?.length) {
    throw new Error(
      levelsJson.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }
  const stockedLocationIds = new Set<string>(
    (
      levelsJson.data?.inventoryItem?.inventoryLevels?.nodes ?? []
    )
      .map((n: { location?: { id?: string } }) => n.location?.id)
      .filter(Boolean) as string[],
  );

  const trackResponse = await admin.graphql(
    `#graphql
    mutation marketplaceTrackInventory($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        id: inventoryItemId,
        input: { tracked: true },
      },
    },
  );
  const trackJson = await trackResponse.json();
  const trackErrors =
    trackJson.data?.inventoryItemUpdate?.userErrors ?? [];
  if (trackErrors.length) {
    throw new Error(
      trackErrors.map((e: { message: string }) => e.message).join(", "),
    );
  }

  // Activate shop location (sets qty when newly activated).
  const activateResponse = await admin.graphql(
    `#graphql
    mutation marketplaceActivateInventory(
      $inventoryItemId: ID!
      $locationId: ID!
      $available: Int
    ) {
      inventoryActivate(
        inventoryItemId: $inventoryItemId
        locationId: $locationId
        available: $available
      ) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        inventoryItemId,
        locationId: primary.id,
        available: quantity,
      },
    },
  );
  const activateJson = await activateResponse.json();
  if (activateJson.errors?.length) {
    throw new Error(
      activateJson.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }
  const activateErrors =
    activateJson.data?.inventoryActivate?.userErrors ?? [];
  const alreadyActive = activateErrors.some((e: { message?: string }) =>
    /already.?stocked|already.?activated/i.test(e.message ?? ""),
  );
  if (activateErrors.length && !alreadyActive) {
    throw new Error(
      activateErrors.map((e: { message: string }) => e.message).join(", "),
    );
  }

  // Absolute set on primary; zero only locations that already stock this item.
  const quantities = [
    {
      inventoryItemId,
      locationId: primary.id,
      quantity,
    },
    ...[...stockedLocationIds]
      .filter((id) => id !== primary.id)
      .map((locationId) => ({
        inventoryItemId,
        locationId,
        quantity: 0,
      })),
  ];

  const setResponse = await admin.graphql(
    `#graphql
    mutation marketplaceSetInventory($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { field message code }
      }
    }`,
    {
      variables: {
        input: {
          name: "available",
          reason: "correction",
          ignoreCompareQuantity: true,
          quantities,
        },
      },
    },
  );
  const setJson = await setResponse.json();
  if (setJson.errors?.length) {
    throw new Error(
      setJson.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }
  const setErrors = setJson.data?.inventorySetQuantities?.userErrors ?? [];
  if (setErrors.length) {
    throw new Error(
      setErrors.map((e: { message: string }) => e.message).join(", "),
    );
  }
}

export async function getProductVendorId(
  admin: AdminGraphql,
  productId: string,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
    query marketplaceProductVendor($id: ID!) {
      product(id: $id) {
        id
        metafield(namespace: "${VENDOR_METAFIELD_NAMESPACE}", key: "${VENDOR_METAFIELD_KEY}") {
          value
        }
      }
    }`,
    { variables: { id: productId } },
  );
  const json = await response.json();
  return json.data?.product?.metafield?.value ?? null;
}

export async function listMarketplaceProducts(
  admin: AdminGraphql,
  options?: { vendorId?: string; first?: number },
) {
  const first = options?.first ?? 50;
  const response = await admin.graphql(
    `#graphql
    query marketplaceProducts($first: Int!) {
      products(first: $first) {
        nodes {
          id
          title
          status
          handle
          featuredImage { url altText }
          totalInventory
          variantsCount {
            count
          }
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
          }
          metafield(namespace: "${VENDOR_METAFIELD_NAMESPACE}", key: "${VENDOR_METAFIELD_KEY}") {
            value
          }
          variants(first: 1) {
            nodes {
              id
              price
              inventoryItem { id }
              inventoryQuantity
            }
          }
        }
      }
    }`,
    { variables: { first } },
  );

  const json = await response.json();
  let products = json.data?.products?.nodes ?? [];
  if (options?.vendorId) {
    products = products.filter(
      (p: { metafield?: { value?: string } | null }) =>
        p.metafield?.value === options.vendorId,
    );
  }
  return products;
}

export async function getProductDetail(admin: AdminGraphql, productId: string) {
  const response = await admin.graphql(
    `#graphql
    query marketplaceProductDetail($id: ID!) {
      product(id: $id) {
        id
        title
        status
        descriptionHtml
        handle
        metafield(namespace: "${VENDOR_METAFIELD_NAMESPACE}", key: "${VENDOR_METAFIELD_KEY}") {
          value
        }
        variants(first: 1) {
          nodes {
            id
            price
            inventoryItem { id }
            inventoryQuantity
          }
        }
      }
    }`,
    { variables: { id: productId } },
  );
  const json = await response.json();
  return json.data?.product ?? null;
}
