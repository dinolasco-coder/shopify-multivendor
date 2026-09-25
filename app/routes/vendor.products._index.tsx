import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Link,
  Page,
  Text,
} from "@shopify/polaris";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { unauthenticated } from "../shopify.server";
import {
  deleteVendorProduct,
  ensureVendorMetafieldsForVendor,
  getProductDetail,
  listMarketplaceProducts,
} from "../services/products.server";
import { fromProductPathId, toProductPathId } from "../utils/product-id";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const { admin } = await unauthenticated.admin(vendor.shop);
  try {
    await ensureVendorMetafieldsForVendor(admin, vendor.id, vendor.name);
  } catch (error) {
    console.error("Failed to backfill vendor metafields", error);
  }

  const products = await listMarketplaceProducts(admin, {
    vendorId: vendor.id,
    first: 50,
  });

  return { products, vendor };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const form = await request.formData();
  if (String(form.get("intent") || "") !== "delete") {
    return { error: "Unknown action." };
  }

  const pathId = String(form.get("productId") || "");
  if (!pathId) return { error: "Missing product." };
  const productId = fromProductPathId(pathId);

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    const existing = await getProductDetail(admin, productId);
    if (!existing || existing.metafield?.value !== vendor.id) {
      return { error: "You can only delete your own products." };
    }

    await deleteVendorProduct(admin, productId);
    return {
      ok: true,
      message: `"${existing.title}" was deleted.`,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to delete product.",
    };
  }
};

export default function VendorProducts() {
  const { products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const deletingId =
    busy && navigation.formData?.get("intent") === "delete"
      ? String(navigation.formData.get("productId") || "")
      : "";

  const rows = products.map(
    (p: {
      id: string;
      title: string;
      status: string;
      totalInventory?: number | null;
      variants?: { nodes?: Array<{ price?: string }> };
    }) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      stock: p.totalInventory ?? "—",
      price: p.variants?.nodes?.[0]?.price
        ? `$${p.variants.nodes[0].price}`
        : "—",
      pathId: toProductPathId(p.id),
    }),
  );

  return (
    <Page
      title="Products"
      primaryAction={{ content: "Add product", url: "/vendor/products/new" }}
    >
      <BlockStack gap="400">
        <Banner tone="info">
          Use <strong>Add product</strong> for the easy photo + speak flow, or
          edit any product from this list.
        </Banner>

        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}
        {actionData && "message" in actionData && actionData.message && (
          <Banner tone="success">{actionData.message}</Banner>
        )}

        <Card padding="0">
          {rows.length === 0 ? (
            <div style={{ padding: 16 }}>
              <Text as="p" tone="subdued">
                No products yet.{" "}
                <Link url="/vendor/products/new">Add your first product</Link>
              </Text>
            </div>
          ) : (
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={rows.length}
              selectable={false}
              headings={[
                { title: "Title" },
                { title: "Status" },
                { title: "Stock" },
                { title: "Price" },
                { title: "Actions" },
              ]}
            >
              {rows.map(
                (
                  row: {
                    id: string;
                    title: string;
                    status: string;
                    stock: number | string;
                    price: string;
                    pathId: string;
                  },
                  index: number,
                ) => (
                <IndexTable.Row id={row.id} key={row.id} position={index}>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {row.title}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{row.status}</IndexTable.Cell>
                  <IndexTable.Cell>{row.stock}</IndexTable.Cell>
                  <IndexTable.Cell>{row.price}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="300" blockAlign="center">
                      <Link url={`/vendor/products/${row.pathId}`}>Edit</Link>
                      <Form
                        method="post"
                        onSubmit={(event) => {
                          if (
                            !confirm(
                              `Delete "${row.title}"? This cannot be undone.`,
                            )
                          ) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input type="hidden" name="intent" value="delete" />
                        <input
                          type="hidden"
                          name="productId"
                          value={row.pathId}
                        />
                        <Button
                          submit
                          tone="critical"
                          variant="plain"
                          loading={deletingId === row.pathId}
                          disabled={busy && deletingId !== row.pathId}
                        >
                          Delete
                        </Button>
                      </Form>
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
