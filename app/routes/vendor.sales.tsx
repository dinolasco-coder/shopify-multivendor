import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  BlockStack,
  Card,
  DataTable,
  InlineGrid,
  Page,
  Text,
} from "@shopify/polaris";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import {
  listAttributionsForVendor,
  salesSummaryForVendor,
} from "../models/attribution.server";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const [summary, attributions] = await Promise.all([
    salesSummaryForVendor(result.vendor.id),
    listAttributionsForVendor(result.vendor.id),
  ]);
  return {
    summary,
    attributions,
    commissionPercent: result.vendor.commissionPercent,
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

export default function VendorSales() {
  const { summary, attributions, commissionPercent } =
    useLoaderData<typeof loader>();

  const rows = attributions.map((row) => [
    row.shopifyOrderName || row.shopifyOrderId,
    formatMoney(row.subtotal, row.currency),
    formatMoney(row.commissionAmount, row.currency),
    formatMoney(row.subtotal - row.commissionAmount, row.currency),
  ]);

  return (
    <Page title="Sales">
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <StatCard label="Orders" value={String(summary.orderCount)} />
          <StatCard
            label="Gross revenue"
            value={formatMoney(summary.revenue, summary.currency)}
          />
          <StatCard
            label={`Platform commission (${commissionPercent}%)`}
            value={formatMoney(summary.commission, summary.currency)}
          />
          <StatCard
            label="Your earnings"
            value={formatMoney(summary.vendorEarnings, summary.currency)}
          />
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Order history
            </Text>
            {rows.length === 0 ? (
              <Text as="p" tone="subdued">
                No sales recorded yet.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                headings={["Order", "Subtotal", "Commission", "You earn"]}
                rows={rows}
              />
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              Payouts are settled manually by the store admin. See Earnings for
              paid vs pending.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
