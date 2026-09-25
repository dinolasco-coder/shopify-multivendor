import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listMarketplaceProducts } from "../services/products.server";
import { listVendors } from "../models/vendor.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const vendorFilter = url.searchParams.get("vendorId") || undefined;

  const [products, vendors] = await Promise.all([
    listMarketplaceProducts(admin, { vendorId: vendorFilter, first: 50 }),
    listVendors(session.shop),
  ]);

  const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v]));

  return {
    products,
    vendors,
    vendorFilter: vendorFilter || "",
    vendorMap,
  };
};

export default function AdminProductsPage() {
  const { products, vendors, vendorFilter, vendorMap } =
    useLoaderData<typeof loader>();

  const marketplaceProducts = products.filter(
    (p: { metafield?: { value?: string } | null }) => p.metafield?.value,
  );

  return (
    <s-page heading="Marketplace products">
      <s-section heading="Filter">
        <form method="get">
          <s-stack direction="inline" gap="base">
            <s-select
              label="Vendor"
              name="vendorId"
              value={vendorFilter}
            >
              <s-option value="">All vendors</s-option>
              {vendors.map((v) => (
                <s-option key={v.id} value={v.id}>
                  {v.name}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit">Apply</s-button>
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Products">
        {marketplaceProducts.length === 0 ? (
          <s-paragraph>
            No marketplace products yet. Approved vendors can add products from
            their portal.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {marketplaceProducts.map(
              (product: {
                id: string;
                title: string;
                status: string;
                totalInventory?: number | null;
                priceRangeV2?: {
                  minVariantPrice?: { amount: string; currencyCode: string };
                };
                metafield?: { value?: string } | null;
              }) => {
                const vendorId = product.metafield?.value || "";
                const vendor = vendorMap[vendorId];
                const price = product.priceRangeV2?.minVariantPrice;
                return (
                  <s-box
                    key={product.id}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                  >
                    <s-stack direction="block" gap="small">
                      <s-heading>{product.title}</s-heading>
                      <s-paragraph>
                        Vendor: {vendor?.name || vendorId || "Unknown"} · Status:{" "}
                        {product.status} · Inventory:{" "}
                        {product.totalInventory ?? "—"}
                        {price
                          ? ` · From ${price.amount} ${price.currencyCode}`
                          : ""}
                      </s-paragraph>
                    </s-stack>
                  </s-box>
                );
              },
            )}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
