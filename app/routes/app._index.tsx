import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { countVendorsByStatus } from "../models/vendor.server";
import { salesSummaryForShop } from "../models/attribution.server";
import { listVendorPayoutBalances } from "../models/payouts.server";
import { getOrCreateSettings } from "../models/settings.server";
import { formatMoney } from "../utils/money";

function appBaseUrl(request: Request) {
  return (
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [statusCounts, sales, settings, balances] = await Promise.all([
    countVendorsByStatus(shop),
    salesSummaryForShop(shop),
    getOrCreateSettings(shop),
    listVendorPayoutBalances(shop),
  ]);

  const payoutOwed = balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0);
  const shopLabel = shop.replace(/\.myshopify\.com$/i, "");

  return {
    statusCounts,
    sales,
    settings,
    payoutOwed,
    shopLabel,
    vendorPortalUrl: `${appBaseUrl(request)}/vendor/login`,
  };
};

function StatCard({
  href,
  label,
  value,
  hint,
  emphasize,
}: {
  href?: string;
  label: string;
  value: string | number;
  hint: string;
  emphasize?: boolean;
}) {
  const inner = (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background={emphasize ? "subdued" : undefined}
    >
      <s-stack direction="block" gap="small-200">
        <s-text>{label}</s-text>
        <s-heading>{value}</s-heading>
        <s-paragraph>{hint}</s-paragraph>
      </s-stack>
    </s-box>
  );

  if (href) {
    return <s-clickable href={href}>{inner}</s-clickable>;
  }
  return inner;
}

export default function Dashboard() {
  const {
    statusCounts,
    sales,
    settings,
    payoutOwed,
    shopLabel,
    vendorPortalUrl,
  } = useLoaderData<typeof loader>();

  const pending = statusCounts.pending ?? 0;
  const approved = statusCounts.approved ?? 0;
  const suspended = statusCounts.suspended ?? 0;
  const totalVendors = pending + approved + suspended;
  const currency = sales.currency;

  return (
    <s-page heading="Marketplace home">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Run sellers on <s-text type="strong">{shopLabel}</s-text>. Customers
            still check out once on your Online Store — this app tracks vendors,
            products, and commission behind the scenes.
          </s-paragraph>

          {pending > 0 ? (
            <s-banner
              tone="warning"
              heading={`${pending} vendor${pending === 1 ? "" : "s"} waiting for approval`}
            >
              Review applications so sellers can start listing products.
              <s-button
                slot="secondary-actions"
                variant="secondary"
                href="/app/vendors"
              >
                Review vendors
              </s-button>
            </s-banner>
          ) : approved === 0 ? (
            <s-banner tone="info" heading="Invite your first seller">
              Create a vendor account, copy the invite message, and send it on
              Messenger, SMS, or email.
              <s-button
                slot="secondary-actions"
                variant="secondary"
                href="/app/vendors"
              >
                Invite a seller
              </s-button>
            </s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="At a glance">
        <s-stack direction="inline" gap="base">
          <StatCard
            href="/app/vendors"
            label="Pending approval"
            value={pending}
            hint="Needs your review"
            emphasize={pending > 0}
          />
          <StatCard
            href="/app/vendors"
            label="Approved sellers"
            value={approved}
            hint={totalVendors ? `${totalVendors} total vendors` : "Ready to sell"}
          />
          <StatCard
            href="/app/vendors"
            label="Suspended"
            value={suspended}
            hint="Blocked from selling"
          />
          <StatCard
            href="/app/orders"
            label="Attributed orders"
            value={sales.orderCount}
            hint="Orders with vendor split"
          />
        </s-stack>
      </s-section>

      <s-section heading="Money">
        <s-stack direction="inline" gap="base">
          <StatCard
            href="/app/orders"
            label="Marketplace revenue"
            value={formatMoney(sales.revenue, currency)}
            hint="Vendor line items attributed"
          />
          <StatCard
            href="/app/orders"
            label="Your commission"
            value={formatMoney(sales.commission, currency)}
            hint={`Default rate ${settings.defaultCommissionPercent}%`}
          />
          <StatCard
            href="/app/payouts"
            label="Owed to sellers"
            value={formatMoney(payoutOwed, currency)}
            hint="Earned minus marked paid"
          />
          <StatCard
            href="/app/settings"
            label="Product approval"
            value={settings.requireProductApproval ? "On" : "Off"}
            hint="Change in Settings"
          />
        </s-stack>
      </s-section>

      <s-section heading="Do this next">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-button href="/app/vendors" variant="primary">
              {pending > 0 ? "Review pending vendors" : "Invite / manage vendors"}
            </s-button>
            <s-button href="/app/products">Marketplace products</s-button>
            <s-button href="/app/orders">Orders & commission</s-button>
            <s-button href="/app/payouts">Payouts</s-button>
            <s-button href="/app/settings">Settings</s-button>
          </s-stack>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="small-200">
              <s-heading>Seller portal</s-heading>
              <s-paragraph>
                Share this login with sellers (or use the invite kit on the
                Vendors page for a full copy-paste message).
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-link href={vendorPortalUrl} target="_blank">
                  {vendorPortalUrl}
                </s-link>
                <s-button href={vendorPortalUrl} target="_blank">
                  Open portal
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
