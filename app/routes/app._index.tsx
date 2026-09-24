import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { countVendorsByStatus } from "../models/vendor.server";
import { salesSummaryForShop } from "../models/attribution.server";
import { getOrCreateSettings } from "../models/settings.server";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [statusCounts, sales, settings] = await Promise.all([
    countVendorsByStatus(shop),
    salesSummaryForShop(shop),
    getOrCreateSettings(shop),
  ]);

  return {
    statusCounts,
    sales,
    settings,
    vendorPortalUrl: "/vendor/login",
  };
};

export default function Dashboard() {
  const { statusCounts, sales, settings, vendorPortalUrl } =
    useLoaderData<typeof loader>();

  const pending = statusCounts.pending ?? 0;
  const approved = statusCounts.approved ?? 0;
  const suspended = statusCounts.suspended ?? 0;

  return (
    <s-page heading="Multi-Vendor Marketplace">
      <s-section heading="Overview">
        <s-paragraph>
          Manage vendors, products, and commission from one place. Customers
          shop normally on your Online Store — products from multiple vendors
          share a single Shopify cart and checkout.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-clickable href="/app/vendors">
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-heading>Vendors pending</s-heading>
              <s-text>{pending}</s-text>
            </s-box>
          </s-clickable>
          <s-clickable href="/app/vendors">
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-heading>Approved vendors</s-heading>
              <s-text>{approved}</s-text>
            </s-box>
          </s-clickable>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>Suspended</s-heading>
            <s-text>{suspended}</s-text>
          </s-box>
          <s-clickable href="/app/orders">
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-heading>Attributed orders</s-heading>
              <s-text>{sales.orderCount}</s-text>
            </s-box>
          </s-clickable>
        </s-stack>
      </s-section>

      <s-section heading="Commission snapshot">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Marketplace revenue:{" "}
            <s-text type="strong">
              {formatMoney(sales.revenue, sales.currency)}
            </s-text>
          </s-paragraph>
          <s-paragraph>
            Commission owed to platform:{" "}
            <s-text type="strong">
              {formatMoney(sales.commission, sales.currency)}
            </s-text>
          </s-paragraph>
          <s-paragraph>
            Default commission: {settings.defaultCommissionPercent}% · Product
            approval{" "}
            {settings.requireProductApproval ? "required" : "not required"}
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Quick links">
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/vendors">Review vendor applications</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/products">Browse marketplace products</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/settings">Adjust default commission</s-link>
          </s-list-item>
          <s-list-item>
            Vendor portal login:{" "}
            <s-link href={vendorPortalUrl} target="_blank">
              {vendorPortalUrl}
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
