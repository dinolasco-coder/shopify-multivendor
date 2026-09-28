import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { countVendorsByStatus } from "../models/vendor.server";
import { salesSummaryForShop } from "../models/attribution.server";
import { listVendorPayoutBalances } from "../models/payouts.server";
import { listMarketplaceProducts } from "../services/products.server";
import { getOrCreateSettings } from "../models/settings.server";
import { formatMoney } from "../utils/money";

function appBaseUrl(request: Request) {
  return (
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin
  );
}

async function fetchShopDashboard(admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}) {
  const response = await admin.graphql(
    `#graphql
    query marketplaceAdminHome {
      shop {
        name
        email
        myshopifyDomain
        primaryDomain { url }
      }
      ordersCount(query: "fulfillment_status:unshipped") {
        count
      }
    }`,
  );
  const json = await response.json();
  return {
    shopName: (json.data?.shop?.name as string) || "Marketplace",
    shopEmail: (json.data?.shop?.email as string) || "",
    shopDomain:
      (json.data?.shop?.myshopifyDomain as string) ||
      (json.data?.shop?.primaryDomain?.url as string) ||
      "",
    unfulfilledOrders: Number(json.data?.ordersCount?.count ?? 0),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [statusCounts, sales, shopInfo, products, balances, settings] =
    await Promise.all([
      countVendorsByStatus(shop),
      salesSummaryForShop(shop),
      fetchShopDashboard(admin).catch(() => ({
        shopName: shop.replace(/\.myshopify\.com$/i, ""),
        shopEmail: "",
        shopDomain: shop,
        unfulfilledOrders: 0,
      })),
      listMarketplaceProducts(admin, { first: 100 }).catch(() => []),
      listVendorPayoutBalances(shop).catch(() => []),
      getOrCreateSettings(shop),
    ]);

  const approved = statusCounts.approved ?? 0;
  const pendingSellers = statusCounts.pending ?? 0;
  const activeProducts = Array.isArray(products)
    ? products.filter(
        (p: { status?: string }) =>
          String(p.status || "").toUpperCase() === "ACTIVE",
      ).length
    : 0;
  const pendingProducts = Array.isArray(products)
    ? products.filter(
        (p: { status?: string; metafield?: { value?: string } | null }) =>
          Boolean(p.metafield?.value) &&
          String(p.status || "").toUpperCase() === "DRAFT",
      ).length
    : 0;

  const payoutOwed = balances.reduce(
    (sum, b) => sum + Math.max(0, b.balance),
    0,
  );

  return {
    shopName: shopInfo.shopName,
    shopEmail: shopInfo.shopEmail,
    shopDomain: shopInfo.shopDomain || shop,
    shopUrl: `https://${(shopInfo.shopDomain || shop).replace(/^https?:\/\//, "")}`,
    revenue: sales.revenue,
    commission: sales.commission,
    currency: sales.currency,
    unfulfilledOrders: shopInfo.unfulfilledOrders,
    activeSellers: approved,
    activeProducts,
    pendingSellers,
    pendingProducts,
    payoutOwed,
    defaultCommissionPercent: settings.defaultCommissionPercent,
    vendorPortalUrl: `${appBaseUrl(request)}/vendor/login`,
  };
};

const styles = `
  .nx-home { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-welcome { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px; }
  .nx-lead { margin: 0 0 20px; color: #6d7175; font-size: 15px; line-height: 1.45; }
  .nx-doors {
    display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; margin-bottom: 20px;
  }
  .nx-door {
    display: flex; flex-direction: column; gap: 10px;
    background: #fff; border: 1px solid #e4e5e7; border-radius: 14px; padding: 22px;
  }
  .nx-door--seller {
    background: #1a1a1a; border-color: #1a1a1a; color: #fff;
  }
  .nx-door__kicker { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.7; }
  .nx-door__title { margin: 0; font-size: 22px; font-weight: 750; letter-spacing: -0.02em; }
  .nx-door__text { margin: 0; font-size: 14px; line-height: 1.45; opacity: 0.85; }
  .nx-door__actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
  .nx-btn {
    border: 1px solid #c9cccf; background: #1a1a1a; color: #fff; border-radius: 8px;
    padding: 11px 14px; font-size: 13px; font-weight: 700; cursor: pointer; text-decoration: none;
    display: inline-flex; align-items: center;
  }
  .nx-btn--ghost { background: #fff; color: #202223; }
  .nx-btn--on-dark { background: #fff; color: #1a1a1a; border-color: #fff; }
  .nx-btn--on-dark-ghost { background: transparent; color: #fff; border-color: rgba(255,255,255,0.35); }
  .nx-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 20px; }
  .nx-metric {
    background: #fff; border: 1px solid #e4e5e7; border-radius: 12px;
    padding: 18px 20px; text-decoration: none; color: inherit; display: block;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .nx-metric:hover { border-color: #c9cccf; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .nx-metric__label { font-size: 13px; color: #6d7175; margin: 0 0 10px; }
  .nx-metric__value { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .nx-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; margin-bottom: 16px; }
  .nx-panel {
    background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; padding: 20px;
  }
  .nx-panel__title { font-size: 16px; font-weight: 700; margin: 0 0 6px; }
  .nx-panel__sub { font-size: 13px; color: #6d7175; margin: 0 0 14px; line-height: 1.45; }
  .nx-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .nx-action {
    display: block; text-decoration: none; color: inherit;
    border: 1px solid #e4e5e7; border-radius: 10px; padding: 14px;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .nx-action:hover { border-color: #c9cccf; background: #fafbfb; }
  .nx-action__title { margin: 0 0 4px; font-size: 14px; font-weight: 700; }
  .nx-action__desc { margin: 0; font-size: 12px; color: #6d7175; line-height: 1.35; }
  .nx-money-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #ececec; font-size: 14px; }
  .nx-money-row:last-child { border-bottom: none; }
  .nx-money-row strong { font-weight: 700; }
  .nx-portal {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 12px;
  }
  .nx-portal code {
    flex: 1; min-width: 180px; font-size: 12px; background: #f6f6f7; border: 1px solid #e4e5e7;
    border-radius: 8px; padding: 10px 12px; word-break: break-all;
  }
  .nx-banner {
    margin: 0 0 16px; padding: 12px 14px; border-radius: 10px; font-size: 14px;
    display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap;
  }
  .nx-banner.warn { background: #fff4d6; color: #5c4500; }
  .nx-banner.info { background: #eaf4ff; color: #004299; }
  .nx-banner a { color: inherit; font-weight: 700; }
  @media (max-width: 900px) {
    .nx-doors { grid-template-columns: 1fr; }
    .nx-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .nx-grid { grid-template-columns: 1fr; }
    .nx-actions { grid-template-columns: 1fr; }
  }
`;

function CopyPortalButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" className="nx-btn" onClick={copy}>
      {copied ? "Copied!" : "Copy login link"}
    </button>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const welcomeName = data.shopName || "there";
  const registerUrl = data.vendorPortalUrl.replace(/\/login\/?$/, "/register");

  return (
    <s-page heading="Marketplace portal">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-home">
        <h1 className="nx-welcome">Marketplace portal</h1>
        <p className="nx-lead">
          Welcome {welcomeName}. Choose seller portal or continue with admin
          tools below.
        </p>

        <div className="nx-doors">
          <div className="nx-door nx-door--seller">
            <p className="nx-door__kicker">For sellers</p>
            <h2 className="nx-door__title">Seller portal</h2>
            <p className="nx-door__text">
              Sellers log in here to add products, check orders, and see
              earnings. Opens in a new tab (outside Shopify Admin).
            </p>
            <div className="nx-door__actions">
              <a
                className="nx-btn nx-btn--on-dark"
                href={data.vendorPortalUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open seller login
              </a>
              <a
                className="nx-btn nx-btn--on-dark-ghost"
                href={registerUrl}
                target="_blank"
                rel="noreferrer"
              >
                Seller register
              </a>
            </div>
          </div>

          <div className="nx-door">
            <p className="nx-door__kicker">For you (store owner)</p>
            <h2 className="nx-door__title">Admin portal</h2>
            <p className="nx-door__text">
              Approve sellers, review products, split orders, and record
              payouts — stays inside this Multivendor app.
            </p>
            <div className="nx-door__actions">
              <Link className="nx-btn" to="/app/vendors">
                Manage sellers
              </Link>
              <Link className="nx-btn nx-btn--ghost" to="/app/products">
                Products
              </Link>
              <Link className="nx-btn nx-btn--ghost" to="/app/orders">
                Orders
              </Link>
            </div>
          </div>
        </div>

        {data.pendingSellers > 0 && (
          <div className="nx-banner warn">
            <span>
              {data.pendingSellers} seller
              {data.pendingSellers === 1 ? "" : "s"} waiting for approval.
            </span>
            <Link to="/app/vendors?tab=needs_review">Review sellers</Link>
          </div>
        )}
        {data.pendingProducts > 0 && (
          <div className="nx-banner info">
            <span>
              {data.pendingProducts} product
              {data.pendingProducts === 1 ? "" : "s"} pending approval.
            </span>
            <Link to="/app/products?tab=pending">Review products</Link>
          </div>
        )}

        <div className="nx-metrics">
          <Link className="nx-metric" to="/app/orders">
            <p className="nx-metric__label">Total revenue</p>
            <p className="nx-metric__value">
              {formatMoney(data.revenue, data.currency)}
            </p>
          </Link>
          <Link className="nx-metric" to="/app/orders?tab=unfulfilled">
            <p className="nx-metric__label">Unfulfilled orders</p>
            <p className="nx-metric__value">{data.unfulfilledOrders}</p>
          </Link>
          <Link className="nx-metric" to="/app/vendors">
            <p className="nx-metric__label">Active sellers</p>
            <p className="nx-metric__value">{data.activeSellers}</p>
          </Link>
          <Link className="nx-metric" to="/app/products">
            <p className="nx-metric__label">Active products</p>
            <p className="nx-metric__value">{data.activeProducts}</p>
          </Link>
        </div>

        <div className="nx-grid">
          <div className="nx-panel">
            <h2 className="nx-panel__title">Quick actions</h2>
            <p className="nx-panel__sub">
              Jump to the tasks you use most when running the marketplace.
            </p>
            <div className="nx-actions">
              <Link className="nx-action" to="/app/vendors">
                <p className="nx-action__title">Invite / manage sellers</p>
                <p className="nx-action__desc">
                  Add sellers, approve applications, set commission.
                </p>
              </Link>
              <Link className="nx-action" to="/app/products">
                <p className="nx-action__title">Review products</p>
                <p className="nx-action__desc">
                  Approve drafts or check what sellers listed.
                </p>
              </Link>
              <Link className="nx-action" to="/app/orders">
                <p className="nx-action__title">View orders</p>
                <p className="nx-action__desc">
                  See fulfillment, payment, and seller splits.
                </p>
              </Link>
              <Link className="nx-action" to="/app/payouts">
                <p className="nx-action__title">Record payouts</p>
                <p className="nx-action__desc">
                  Mark what you already paid sellers outside Shopify.
                </p>
              </Link>
            </div>
          </div>

          <div className="nx-panel">
            <h2 className="nx-panel__title">Money snapshot</h2>
            <p className="nx-panel__sub">
              Default commission is {data.defaultCommissionPercent}%.
            </p>
            <div className="nx-money-row">
              <span>Marketplace revenue</span>
              <strong>{formatMoney(data.revenue, data.currency)}</strong>
            </div>
            <div className="nx-money-row">
              <span>Your commission</span>
              <strong>{formatMoney(data.commission, data.currency)}</strong>
            </div>
            <div className="nx-money-row">
              <span>Owed to sellers</span>
              <strong>{formatMoney(data.payoutOwed, data.currency)}</strong>
            </div>
            <div className="nx-portal">
              <Link className="nx-btn nx-btn--ghost" to="/app/payouts">
                Open payouts
              </Link>
              <Link className="nx-btn nx-btn--ghost" to="/app/settings">
                Settings
              </Link>
            </div>
          </div>
        </div>

        <div className="nx-panel">
          <h2 className="nx-panel__title">Share seller portal link</h2>
          <p className="nx-panel__sub">
            Send this to sellers, or use the invite kit on the Sellers page.
          </p>
          <div className="nx-portal">
            <code>{data.vendorPortalUrl}</code>
            <CopyPortalButton url={data.vendorPortalUrl} />
            <a
              className="nx-btn nx-btn--ghost"
              href={data.vendorPortalUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
