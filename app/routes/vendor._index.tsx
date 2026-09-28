import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Link,
  Page,
  ResourceList,
  ResourceItem,
  Text,
} from "@shopify/polaris";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import {
  listAttributionsForVendor,
  salesSummaryForVendor,
} from "../models/attribution.server";
import { unauthenticated } from "../shopify.server";
import { listMarketplaceProducts } from "../services/products.server";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const [summary, attributions] = await Promise.all([
    salesSummaryForVendor(vendor.id),
    listAttributionsForVendor(vendor.id),
  ]);

  let productCount = 0;
  let lowStock = 0;
  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    const products = await listMarketplaceProducts(admin, {
      vendorId: vendor.id,
      first: 50,
    });
    productCount = products.length;
    lowStock = products.filter(
      (p: { totalInventory?: number | null }) =>
        (p.totalInventory ?? 0) > 0 && (p.totalInventory ?? 0) <= 5,
    ).length;
  } catch (error) {
    console.error("Vendor dashboard product fetch failed", error);
  }

  return {
    vendor,
    summary,
    recentOrders: attributions.slice(0, 5),
    productCount,
    lowStock,
  };
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

export default function VendorDashboard() {
  const { vendor, summary, recentOrders, productCount, lowStock } =
    useLoaderData<typeof loader>();

  return (
    <Page title={`Welcome, ${vendor.name}`}>
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              What do you want to do?
            </Text>
            <InlineStack gap="300" wrap>
              <Button variant="primary" size="large" url="/vendor/products/new">
                Add a product
              </Button>
              <Button size="large" url="/vendor/products">
                My products
              </Button>
              <Button size="large" url="/vendor/orders">
                My orders
              </Button>
              <Button size="large" url="/vendor/earnings">
                My earnings
              </Button>
            </InlineStack>
            <Text as="p" tone="subdued">
              Tip: on Add a product you can use a photo and speak the name and
              price.
            </Text>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <StatCard label="Products" value={String(productCount)} />
          <StatCard
            label="Revenue"
            value={formatMoney(summary.revenue, summary.currency)}
          />
          <StatCard
            label="Your earnings"
            value={formatMoney(summary.vendorEarnings, summary.currency)}
          />
          <StatCard label="Low stock" value={String(lowStock)} />
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Recent orders
              </Text>
              <Link url="/vendor/orders">See all</Link>
            </InlineStack>
            {recentOrders.length === 0 ? (
              <Text as="p" tone="subdued">
                No orders for you yet. When customers buy your products, they
                show up here.
              </Text>
            ) : (
              <ResourceList
                items={recentOrders.map((o) => ({
                  id: o.id,
                  name: o.shopifyOrderName || o.shopifyOrderId,
                  amount: formatMoney(o.subtotal, o.currency),
                }))}
                renderItem={(item) => (
                  <ResourceItem id={item.id} url="/vendor/orders">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {item.name}
                    </Text>
                    <div>
                      <Text as="span" tone="subdued">
                        {item.amount}
                      </Text>
                    </div>
                  </ResourceItem>
                )}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
