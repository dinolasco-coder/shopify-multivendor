import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  BlockStack,
  Card,
  InlineGrid,
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
      <BlockStack gap="400">
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
            <Text as="h2" variant="headingMd">
              Recent orders
            </Text>
            {recentOrders.length === 0 ? (
              <Text as="p" tone="subdued">
                No orders attributed to you yet.
              </Text>
            ) : (
              <ResourceList
                items={recentOrders.map((o) => ({
                  id: o.id,
                  name: o.shopifyOrderName || o.shopifyOrderId,
                  amount: formatMoney(o.subtotal, o.currency),
                }))}
                renderItem={(item) => (
                  <ResourceItem id={item.id} onClick={() => undefined}>
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
            <Text as="p" variant="bodySm">
              <Link url="/vendor/products">Manage products</Link>
              {" · "}
              <Link url="/vendor/orders">All orders</Link>
              {" · "}
              <Link url="/vendor/sales">Sales report</Link>
              {" · "}
              <Link url="/vendor/earnings">Earnings</Link>
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
