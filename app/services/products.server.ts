import {
  AI_CUSTOMIZATION_FEE_KEY,
  AI_CUSTOMIZATION_FEE_NAMESPACE,
  VENDOR_METAFIELD_KEY,
  VENDOR_METAFIELD_NAMESPACE,
} from "../constants";
import {
  aiCustomizationFeeMetafieldInput,
  vendorMetafieldInput,
} from "./metafields.server";

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
    /** Optional decimal string for custom.ai_customization_fee */
    aiCustomizationFee?: string | null;
  },
) {
  const metafields = [vendorMetafieldInput(input.vendorId)];
  if (input.aiCustomizationFee) {
    metafields.push(aiCustomizationFeeMetafieldInput(input.aiCustomizationFee));
  }

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
          metafields,
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
    const priceResponse = await admin.graphql(
      `#graphql
      mutation marketplaceVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
            inventoryItem { id }
          }
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
              inventoryItem: { tracked: true, requiresShipping: true },
            },
          ],
        },
      },
    );
    const priceJson = await priceResponse.json();
    const priceErrors =
      priceJson.data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (priceErrors.length) {
      throw new Error(
        priceErrors.map((e: { message: string }) => e.message).join(", "),
      );
    }

    let inventoryItemId =
      priceJson.data?.productVariantsBulkUpdate?.productVariants?.[0]
        ?.inventoryItem?.id ||
      variant.inventoryItem?.id ||
      null;

    if (!inventoryItemId) {
      inventoryItemId = await getInventoryItemId(
        admin,
        product.id,
        variant.id,
      );
    }

    if (!inventoryItemId) {
      throw new Error(
        "Product was created but Shopify did not return an inventory item. Open the product in Admin and try Edit → Shop location quantity.",
      );
    }

    if (input.inventoryQuantity >= 0) {
      await setInventoryQuantity(
        admin,
        inventoryItemId,
        input.inventoryQuantity,
      );
    }

    await associateVariantWithDefaultShippingProfile(admin, variant.id);
  }

  if (input.images?.length) {
    await attachProductImages(admin, product.id, input.images);
  }

  await publishProductToStorefronts(admin, product.id);
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
    /** When set (including empty string), updates custom.ai_customization_fee */
    aiCustomizationFee?: string | null;
  },
) {
  const metafields: Array<ReturnType<typeof vendorMetafieldInput>> = [];
  if (
    input.aiCustomizationFee !== undefined &&
    input.aiCustomizationFee !== null &&
    input.aiCustomizationFee !== ""
  ) {
    metafields.push(
      aiCustomizationFeeMetafieldInput(input.aiCustomizationFee),
    );
  }

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
          ...(metafields.length ? { metafields } : {}),
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

function parsePublicationIdsFromEnv(): string[] {
  return (process.env.PUBLISH_PUBLICATION_IDS || "")
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Match Online Store + Headless/Hydrogen via app handle/title (not catalog title). */
function isTargetStorefrontApp(app?: {
  title?: string | null;
  handle?: string | null;
} | null): boolean {
  const handle = (app?.handle || "").toLowerCase();
  const title = (app?.title || "").toLowerCase();
  if (!handle && !title) return false;

  if (
    handle === "online_store" ||
    handle.includes("online_store") ||
    title === "online store" ||
    title.includes("online store")
  ) {
    return true;
  }

  // Headless storefronts are separate publications; identify via owning app.
  if (
    handle === "headless" ||
    handle.includes("headless") ||
    handle.includes("hydrogen") ||
    title.includes("headless") ||
    title.includes("hydrogen")
  ) {
    return true;
  }

  return false;
}

type AppNode = { title?: string | null; handle?: string | null };

/**
 * Online Store + every Headless/Hydrogen storefront publication.
 * Catalog titles are often opaque ("Channel Catalog …") or custom storefront
 * names, so we match AppCatalog.apps handle/title instead.
 */
async function resolveStorefrontPublicationIds(
  admin: AdminGraphql,
): Promise<string[]> {
  const fromEnv = parsePublicationIdsFromEnv();
  if (fromEnv.length) return fromEnv;

  const pubsResponse = await admin.graphql(
    `#graphql
    query marketplacePublications {
      publications(first: 50, catalogType: APP) {
        nodes {
          id
          name
          catalog {
            title
            ... on AppCatalog {
              apps(first: 10) {
                nodes {
                  title
                  handle
                }
              }
            }
          }
          app {
            title
            handle
          }
        }
      }
    }`,
  );
  const pubsJson = await pubsResponse.json();
  if (pubsJson.errors?.length) {
    console.error("marketplacePublications errors", pubsJson.errors);
  }

  const publications: {
    id?: string;
    name?: string;
    catalog?: {
      title?: string;
      apps?: { nodes?: AppNode[] };
    } | null;
    app?: AppNode | null;
  }[] = pubsJson.data?.publications?.nodes ?? [];

  const seen = new Set<string>();
  const publicationIds: string[] = [];
  const matched: { id: string; reason: string }[] = [];

  for (const publication of publications) {
    if (!publication.id || seen.has(publication.id)) continue;

    const apps: AppNode[] = [
      ...(publication.catalog?.apps?.nodes ?? []),
      ...(publication.app ? [publication.app] : []),
    ];
    const appMatch = apps.find((app) => isTargetStorefrontApp(app));

    // Legacy name fallback (deprecated) — Online Store often still appears here.
    const nameMatch =
      /online store/i.test(publication.name ?? "") ||
      /headless|hydrogen/i.test(publication.name ?? "") ||
      /online store/i.test(publication.catalog?.title ?? "") ||
      /headless|hydrogen/i.test(publication.catalog?.title ?? "");

    if (!appMatch && !nameMatch) continue;

    seen.add(publication.id);
    publicationIds.push(publication.id);
    matched.push({
      id: publication.id,
      reason: appMatch
        ? `app:${appMatch.handle || appMatch.title}`
        : `name:${publication.name || publication.catalog?.title}`,
    });
  }

  if (!publicationIds.length) {
    console.error("Could not find Online Store or Headless publications", {
      publications: publications.map((p) => ({
        id: p.id,
        name: p.name,
        catalog: p.catalog?.title,
        apps: (p.catalog?.apps?.nodes ?? []).map(
          (a) => a.handle || a.title,
        ),
        app: p.app?.handle || p.app?.title,
      })),
    });
  } else {
    console.info("Publishing product to publications", matched);
  }

  return publicationIds;
}

async function publishProductToStorefronts(
  admin: AdminGraphql,
  productId: string,
) {
  const publicationIds = await resolveStorefrontPublicationIds(admin);
  if (!publicationIds.length) return;

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
        input: publicationIds.map((publicationId) => ({ publicationId })),
      },
    },
  );
  const publishJson = await publishResponse.json();
  if (publishJson.errors?.length) {
    console.error("publishablePublish graphql errors", publishJson.errors);
  }
  const errors = publishJson.data?.publishablePublish?.userErrors ?? [];
  if (errors.length) {
    console.error("publishablePublish errors", errors);
  }
}

type InventoryLocation = {
  id: string;
  name?: string;
  isActive?: boolean;
  fulfillsOnlineOrders?: boolean;
};

async function listInventoryLocations(
  admin: AdminGraphql,
): Promise<{
  active: InventoryLocation[];
  online: InventoryLocation[];
  defaultLocation: InventoryLocation | null;
}> {
  const locResponse = await admin.graphql(
    `#graphql
    query marketplaceInventoryLocations {
      defaultLocation: location {
        id
        name
        isActive
        fulfillsOnlineOrders
      }
      locations(first: 50) {
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

  const locations: InventoryLocation[] =
    locJson.data?.locations?.nodes ?? [];
  const active = locations.filter((l) => l.isActive !== false);
  const defaultLocation = (locJson.data?.defaultLocation ??
    null) as InventoryLocation | null;
  const online = active.filter((l) => l.fulfillsOnlineOrders);

  return { active, online, defaultLocation };
}

/**
 * Pick where seller stock should live for checkout.
 * Always prefer locations that fulfill online orders — otherwise Admin can
 * show quantity while Checkout says "Out of stock".
 */
async function resolveInventoryLocation(admin: AdminGraphql): Promise<{
  id: string;
  name?: string;
}> {
  const preferredName = (process.env.VENDOR_INVENTORY_LOCATION_NAME || "")
    .trim()
    .toLowerCase();
  const preferredId = (process.env.VENDOR_INVENTORY_LOCATION_ID || "").trim();
  const { active, online, defaultLocation } =
    await listInventoryLocations(admin);

  const nameIncludes = (l: { name?: string }, needle: string) =>
    (l.name || "").toLowerCase().includes(needle);

  // Prefer online-fulfilling locations first (checkout uses these).
  const pool = online.length ? online : active;

  const primary =
    (preferredId && pool.find((l) => l.id === preferredId)) ||
    (preferredName && pool.find((l) => nameIncludes(l, preferredName))) ||
    pool.find((l) => nameIncludes(l, "shop")) ||
    (defaultLocation?.id &&
      pool.find((l) => l.id === defaultLocation.id)) ||
    (defaultLocation?.isActive !== false &&
      defaultLocation?.fulfillsOnlineOrders &&
      defaultLocation) ||
    pool[0] ||
    active[0];

  if (!primary?.id) {
    throw new Error(
      "No active shop location found to store inventory. Add a location in Shopify Admin → Settings → Locations, and turn on “Fulfill online orders” for that location.",
    );
  }
  return primary;
}

/** All locations checkout can sell from (stock must exist here). */
async function resolveOnlineInventoryLocations(
  admin: AdminGraphql,
): Promise<InventoryLocation[]> {
  const { online, active } = await listInventoryLocations(admin);
  if (online.length) return online;
  const primary = await resolveInventoryLocation(admin);
  const match = active.find((l) => l.id === primary.id);
  return match ? [match] : [{ id: primary.id, name: primary.name }];
}

async function getInventoryItemId(
  admin: AdminGraphql,
  productId: string,
  variantId?: string,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
    query marketplaceVariantInventory($id: ID!) {
      product(id: $id) {
        variants(first: 10) {
          nodes {
            id
            inventoryItem { id tracked }
          }
        }
      }
    }`,
    { variables: { id: productId } },
  );
  const json = await response.json();
  const nodes: Array<{
    id?: string;
    inventoryItem?: { id?: string } | null;
  }> = json.data?.product?.variants?.nodes ?? [];
  const match = variantId
    ? nodes.find((n) => n.id === variantId)
    : nodes[0];
  return match?.inventoryItem?.id ?? nodes[0]?.inventoryItem?.id ?? null;
}

async function activateInventoryAtLocation(
  admin: AdminGraphql,
  inventoryItemId: string,
  locationId: string,
  stockedLocationIds: Set<string>,
) {
  if (stockedLocationIds.has(locationId)) return;

  const activateResponse = await admin.graphql(
    `#graphql
    mutation marketplaceActivateInventory(
      $inventoryItemId: ID!
      $locationId: ID!
    ) {
      inventoryActivate(
        inventoryItemId: $inventoryItemId
        locationId: $locationId
      ) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        inventoryItemId,
        locationId,
      },
    },
  );
  const activateJson = await activateResponse.json();
  if (activateJson.errors?.length) {
    throw new Error(
      activateJson.errors
        .map((e: { message: string }) => e.message)
        .join(", "),
    );
  }
  const activateErrors =
    activateJson.data?.inventoryActivate?.userErrors ?? [];
  const alreadyActive = activateErrors.some((e: { message?: string }) =>
    /already.?stocked|already.?activated|already active|not allowed to set available/i.test(
      e.message ?? "",
    ),
  );
  if (activateErrors.length && !alreadyActive) {
    throw new Error(
      activateErrors.map((e: { message: string }) => e.message).join(", "),
    );
  }
  stockedLocationIds.add(locationId);
}

async function setQuantityAtLocations(
  admin: AdminGraphql,
  inventoryItemId: string,
  locationIds: string[],
  quantity: number,
) {
  const quantities = locationIds.map((locationId) => ({
    inventoryItemId,
    locationId,
    quantity,
  }));

  const setResponse = await admin.graphql(
    `#graphql
    mutation marketplaceSetInventory($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
          changes { name delta quantityAfterChange }
        }
        userErrors { field message code }
      }
    }`,
    {
      variables: {
        input: {
          name: "on_hand",
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
  if (!setErrors.length) return;

  // Fallback: some shops reject on_hand; try available.
  const fallback = await admin.graphql(
    `#graphql
    mutation marketplaceSetInventoryAvailable($input: InventorySetQuantitiesInput!) {
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
  const fallbackJson = await fallback.json();
  const fallbackErrors =
    fallbackJson.data?.inventorySetQuantities?.userErrors ?? [];
  if (fallbackJson.errors?.length || fallbackErrors.length) {
    throw new Error(
      [
        ...setErrors.map((e: { message: string }) => e.message),
        ...(fallbackJson.errors ?? []).map(
          (e: { message: string }) => e.message,
        ),
        ...fallbackErrors.map((e: { message: string }) => e.message),
      ].join(", "),
    );
  }
}

async function setInventoryQuantity(
  admin: AdminGraphql,
  inventoryItemId: string,
  quantity: number,
  options?: { preferLocationIds?: string[] },
) {
  // Keep the full quantity on ONE ship-from location only.
  // Writing the same qty to every location inflated Admin "total" stock.
  const primary = await resolveInventoryLocation(admin);
  const preferred = (options?.preferLocationIds || []).filter(Boolean);
  const targetId =
    preferred.find((id) => id === primary.id) || preferred[0] || primary.id;
  const qty = Math.max(0, Math.floor(quantity));

  const levelsResponse = await admin.graphql(
    `#graphql
    query marketplaceInventoryLevels($id: ID!) {
      inventoryItem(id: $id) {
        id
        tracked
        inventoryLevels(first: 50) {
          nodes {
            location { id name }
            quantities(names: ["available", "on_hand"]) {
              name
              quantity
            }
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

  const levelNodes: Array<{ location?: { id?: string } }> =
    levelsJson.data?.inventoryItem?.inventoryLevels?.nodes ?? [];
  const stockedLocationIds = new Set<string>(
    levelNodes
      .map((n) => n.location?.id)
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
        // Physical products must require shipping or checkout may hide Ship.
        input: { tracked: true, requiresShipping: true },
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

  await activateInventoryAtLocation(
    admin,
    inventoryItemId,
    targetId,
    stockedLocationIds,
  );

  // Target gets the real qty; other stocked locations go to 0 (undo duplicates).
  const otherIds = [...stockedLocationIds].filter((id) => id !== targetId);
  await setQuantityAtLocations(admin, inventoryItemId, [targetId], qty);
  if (otherIds.length) {
    await setQuantityAtLocations(admin, inventoryItemId, otherIds, 0);
  }
}

type DeliveryProfileNode = {
  id: string;
  name?: string;
  default?: boolean;
  profileLocationGroups?: Array<{
    locationGroup?: {
      locations?: {
        nodes?: Array<{ id: string; name?: string; fulfillsOnlineOrders?: boolean }>;
      };
    };
    locationGroupZones?: {
      nodes?: Array<{
        methodDefinitionsCount?: { count?: number } | null;
        methodDefinitions?: {
          nodes?: Array<{ id?: string; active?: boolean | null }>;
        };
      }>;
    };
  }>;
};

async function loadDeliveryProfiles(
  admin: AdminGraphql,
): Promise<{ profiles: DeliveryProfileNode[]; error?: string }> {
  const profilesResponse = await admin.graphql(
    `#graphql
    query marketplaceDeliveryProfilesDetailed {
      deliveryProfiles(first: 25) {
        nodes {
          id
          name
          default
          profileLocationGroups {
            locationGroup {
              locations(first: 50) {
                nodes { id name fulfillsOnlineOrders }
              }
            }
            locationGroupZones(first: 20) {
              nodes {
                methodDefinitions(first: 20) {
                  nodes { id active }
                }
              }
            }
          }
        }
      }
    }`,
  );
  const profilesJson = await profilesResponse.json();
  if (profilesJson.errors?.length) {
    const msg = profilesJson.errors
      .map((e: { message: string }) => e.message)
      .join(", ");
    const needsScope = /access denied|shipping|scope|not approved/i.test(msg);
    return {
      profiles: [],
      error: needsScope
        ? "Missing shipping permissions. Add read_shipping,write_shipping to Railway SCOPES, redeploy, then Multivendor → Settings → Re-authorize Shopify permissions."
        : msg,
    };
  }
  return { profiles: profilesJson.data?.deliveryProfiles?.nodes ?? [] };
}

function countActiveShippingMethods(profile: DeliveryProfileNode): number {
  let count = 0;
  for (const group of profile.profileLocationGroups || []) {
    for (const zone of group.locationGroupZones?.nodes || []) {
      for (const method of zone.methodDefinitions?.nodes || []) {
        if (method?.id && method.active !== false) count += 1;
      }
    }
  }
  return count;
}

function locationsForProfile(profile: DeliveryProfileNode): InventoryLocation[] {
  const out: InventoryLocation[] = [];
  const seen = new Set<string>();
  for (const group of profile.profileLocationGroups || []) {
    for (const loc of group.locationGroup?.locations?.nodes || []) {
      if (!loc?.id || seen.has(loc.id)) continue;
      seen.add(loc.id);
      out.push({
        id: loc.id,
        name: loc.name,
        fulfillsOnlineOrders: loc.fulfillsOnlineOrders,
      });
    }
  }
  return out;
}

function pickBestShippingProfile(
  profiles: DeliveryProfileNode[],
): DeliveryProfileNode | null {
  if (!profiles.length) return null;
  const scored = [...profiles].sort((a, b) => {
    const methodsDiff =
      countActiveShippingMethods(b) - countActiveShippingMethods(a);
    if (methodsDiff !== 0) return methodsDiff;
    if (Boolean(b.default) !== Boolean(a.default)) return b.default ? 1 : -1;
    if (/general/i.test(b.name || "") !== /general/i.test(a.name || "")) {
      return /general/i.test(b.name || "") ? 1 : -1;
    }
    return 0;
  });
  return scored[0] || null;
}

/**
 * Put seller variants on a shipping profile that has active rates so checkout
 * can show Ship (not only Pickup). Requires read_shipping + write_shipping.
 */
export async function associateVariantWithDefaultShippingProfile(
  admin: AdminGraphql,
  variantId: string,
): Promise<{
  ok: boolean;
  profileName?: string;
  locationIds?: string[];
  error?: string;
}> {
  try {
    const { profiles, error } = await loadDeliveryProfiles(admin);
    if (error) return { ok: false, error };
    const profile = pickBestShippingProfile(profiles);
    if (!profile?.id) {
      return { ok: false, error: "No shipping profile found in this shop." };
    }
    if (countActiveShippingMethods(profile) === 0) {
      return {
        ok: false,
        error: `Shipping profile “${profile.name || "General"}” has no active shipping rates. Add SPX/rates in Settings → Shipping and delivery.`,
      };
    }

    const updateResponse = await admin.graphql(
      `#graphql
      mutation marketplaceAssociateShippingProfile(
        $id: ID!
        $profile: DeliveryProfileInput!
      ) {
        deliveryProfileUpdate(id: $id, profile: $profile) {
          profile { id name }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          id: profile.id,
          profile: { variantsToAssociate: [variantId] },
        },
      },
    );
    const updateJson = await updateResponse.json();
    if (updateJson.errors?.length) {
      const msg = updateJson.errors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return {
        ok: false,
        error: /access denied|scope|not approved/i.test(msg)
          ? "Missing write_shipping permission. Multivendor → Settings → Re-authorize Shopify permissions, then try again."
          : msg,
      };
    }
    const userErrors =
      updateJson.data?.deliveryProfileUpdate?.userErrors ?? [];
    if (userErrors.length) {
      return {
        ok: false,
        error: userErrors.map((e: { message: string }) => e.message).join(", "),
      };
    }
    const locs = locationsForProfile(profile);
    return {
      ok: true,
      profileName:
        updateJson.data?.deliveryProfileUpdate?.profile?.name || profile.name,
      locationIds: locs.map((l) => l.id),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readMaxAvailableQuantity(
  admin: AdminGraphql,
  inventoryItemId: string,
  fallback: number,
): Promise<number> {
  const levelsResponse = await admin.graphql(
    `#graphql
    query marketplaceInventoryQty($id: ID!) {
      inventoryItem(id: $id) {
        inventoryLevels(first: 50) {
          nodes {
            quantities(names: ["available", "on_hand"]) {
              name
              quantity
            }
          }
        }
      }
    }`,
    { variables: { id: inventoryItemId } },
  );
  const levelsJson = await levelsResponse.json();
  let max = fallback;
  for (const level of levelsJson.data?.inventoryItem?.inventoryLevels?.nodes ??
    []) {
    for (const q of level.quantities || []) {
      if (typeof q.quantity === "number" && q.quantity > max) max = q.quantity;
    }
  }
  return Math.max(0, Math.floor(max));
}

/**
 * Repair a marketplace product for Ship checkout:
 * stock on shipping-profile locations + requires shipping + shipping profile.
 */
export async function fixProductForShippingCheckout(
  admin: AdminGraphql,
  productId: string,
): Promise<{
  title: string;
  quantity: number;
  shippingProfile?: string;
  warning?: string;
}> {
  const product = await getProductDetail(admin, productId);
  if (!product) throw new Error("Product not found.");

  const variant = product.variants?.nodes?.[0];
  const inventoryItemId = variant?.inventoryItem?.id;
  if (!variant?.id || !inventoryItemId) {
    throw new Error(`"${product.title}" has no inventory item.`);
  }

  const fallbackQty = Math.max(
    0,
    Math.floor(Number(variant.inventoryQuantity ?? product.totalInventory ?? 0)),
  );
  const quantity = await readMaxAvailableQuantity(
    admin,
    inventoryItemId,
    fallbackQty,
  );
  if (quantity <= 0) {
    throw new Error(
      `"${product.title}" has 0 stock. Set quantity in seller Edit or Shopify Admin first, then Fix shipping again.`,
    );
  }

  const profileResult = await associateVariantWithDefaultShippingProfile(
    admin,
    variant.id,
  );

  // Consolidate stock onto one shipping location (fixes inflated totals).
  await setInventoryQuantity(admin, inventoryItemId, quantity, {
    preferLocationIds: profileResult.locationIds,
  });

  if (!profileResult.ok) {
    throw new Error(
      `Stock consolidated for “${product.title}”, but shipping profile failed: ${profileResult.error}`,
    );
  }

  return {
    title: product.title,
    quantity,
    shippingProfile: profileResult.profileName,
  };
}

export async function fixAllMarketplaceProductsForShipping(
  admin: AdminGraphql,
): Promise<{ fixed: number; skipped: number; errors: string[] }> {
  const products = (
    (await listMarketplaceProducts(admin, { first: 100 })) as Array<{
      id?: string;
      title?: string;
      metafield?: { value?: string } | null;
    }>
  ).filter((p) => p.metafield?.value);
  let fixed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const product of products) {
    if (!product.id) {
      skipped += 1;
      continue;
    }
    try {
      await fixProductForShippingCheckout(admin, product.id);
      fixed += 1;
    } catch (error) {
      skipped += 1;
      errors.push(
        `${product.title || product.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { fixed, skipped, errors };
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
        aiCustomizationFee: metafield(
          namespace: "${AI_CUSTOMIZATION_FEE_NAMESPACE}"
          key: "${AI_CUSTOMIZATION_FEE_KEY}"
        ) {
          value
        }
        totalInventory
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
