import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Banner,
  BlockStack,
  Card,
  IndexTable,
  Link,
  Page,
  Text,
} from "@shopify/polaris";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { unauthenticated } from "../shopify.server";
import {
  ensureVendorMetafieldsForVendor,
  listMarketplaceProducts,
} from "../services/products.server";
import { toProductPathId } from "../utils/product-id";

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

export default function VendorProducts() {
  const { products } = useLoaderData<typeof loader>();

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
                { title: "" },
              ]}
            >
              {rows.map((row, index) => (
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
                    <Link url={`/vendor/products/${row.pathId}`}>Edit</Link>
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
