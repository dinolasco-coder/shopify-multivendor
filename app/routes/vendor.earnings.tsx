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
import { getVendorEarningsSummary } from "../models/payouts.server";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const summary = await getVendorEarningsSummary(result.vendor.id);
  return {
    summary,
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

export default function VendorEarnings() {
  const { summary, commissionPercent } = useLoaderData<typeof loader>();

  const rows = summary.payouts.map((p) => [
    new Date(p.paidAt).toISOString().slice(0, 10),
    formatMoney(p.amount, p.currency),
    p.reference || "—",
    p.note || "—",
  ]);

  return (
    <Page title="Earnings">
      <BlockStack gap="400">
        <Text as="p" tone="subdued">
          Platform commission rate: {commissionPercent}%. Payouts are paid
          manually by the store admin (see history below).
        </Text>

        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
          <StatCard
            label="Gross revenue"
            value={formatMoney(summary.revenue, summary.currency)}
          />
          <StatCard
            label="Platform commission"
            value={formatMoney(summary.commission, summary.currency)}
          />
          <StatCard
            label="Your earnings"
            value={formatMoney(summary.earned, summary.currency)}
          />
          <StatCard
            label="Already paid"
            value={formatMoney(summary.paid, summary.currency)}
          />
          <StatCard
            label="Pending payout"
            value={formatMoney(summary.pending, summary.currency)}
          />
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Payout history
            </Text>
            {rows.length === 0 ? (
              <Text as="p" tone="subdued">
                No payouts recorded yet.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "text", "text"]}
                headings={["Date", "Amount", "Reference", "Note"]}
                rows={rows}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
