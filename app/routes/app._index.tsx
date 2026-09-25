import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { countVendorsByStatus } from "../models/vendor.server";
import { salesSummaryForShop } from "../models/attribution.server";
import { listMarketplaceProducts } from "../services/products.server";
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

  const [statusCounts, sales, shopInfo, products] = await Promise.all([
    countVendorsByStatus(shop),
    salesSummaryForShop(shop),
    fetchShopDashboard(admin).catch(() => ({
      shopName: shop.replace(/\.myshopify\.com$/i, ""),
      shopEmail: "",
      shopDomain: shop,
      unfulfilledOrders: 0,
    })),
    listMarketplaceProducts(admin, { first: 100 }).catch(() => []),
  ]);

  const approved = statusCounts.approved ?? 0;
  const pendingSellers = statusCounts.pending ?? 0;
  const activeProducts = Array.isArray(products)
    ? products.filter(
        (p: { status?: string }) => String(p.status || "").toUpperCase() === "ACTIVE",
      ).length
    : 0;
  const pendingProducts = Array.isArray(products)
    ? products.filter(
        (p: { status?: string; metafield?: { value?: string } | null }) =>
          Boolean(p.metafield?.value) &&
          String(p.status || "").toUpperCase() === "DRAFT",
      ).length
    : 0;

  return {
    shopName: shopInfo.shopName,
    shopEmail: shopInfo.shopEmail,
    shopDomain: shopInfo.shopDomain || shop,
    shopUrl: `https://${(shopInfo.shopDomain || shop).replace(/^https?:\/\//, "")}`,
    revenue: sales.revenue,
    currency: sales.currency,
    unfulfilledOrders: shopInfo.unfulfilledOrders,
    activeSellers: approved,
    activeProducts,
    pendingSellers,
    pendingProducts,
    vendorPortalUrl: `${appBaseUrl(request)}/vendor/login`,
  };
};

const styles = `
  .nx-home { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-welcome { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 20px; }
  .nx-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 28px; }
  .nx-metric {
    background: #fff; border: 1px solid #e4e5e7; border-radius: 12px;
    padding: 18px 20px; text-decoration: none; color: inherit; display: block;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .nx-metric:hover { border-color: #c9cccf; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .nx-metric__label { font-size: 13px; color: #6d7175; margin: 0 0 10px; }
  .nx-metric__value { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .nx-panel {
    background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; padding: 24px;
  }
  .nx-panel__title { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
  .nx-panel__sub { font-size: 14px; color: #6d7175; margin: 0 0 20px; line-height: 1.45; max-width: 720px; }
  .nx-guides { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .nx-guide { text-decoration: none; color: inherit; display: block; }
  .nx-guide__thumb {
    position: relative; height: 140px; border-radius: 10px; overflow: hidden;
    background: linear-gradient(135deg, #4a1d6a 0%, #8b2d9b 45%, #d946a6 100%);
    display: flex; align-items: center; justify-content: center; margin-bottom: 12px;
  }
  .nx-guide__thumb-label {
    position: absolute; left: 14px; bottom: 12px; right: 14px;
    color: #fff; font-size: 14px; font-weight: 600; line-height: 1.3;
    text-shadow: 0 1px 2px rgba(0,0,0,0.35);
  }
  .nx-guide__play {
    width: 44px; height: 44px; border-radius: 999px; background: rgba(255,255,255,0.95);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }
  .nx-guide__play svg { margin-left: 2px; }
  .nx-guide__title { font-size: 14px; font-weight: 650; margin: 0 0 4px; }
  .nx-guide__desc { font-size: 13px; color: #6d7175; margin: 0; line-height: 1.4; }
  @media (max-width: 900px) {
    .nx-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .nx-guides { grid-template-columns: 1fr; }
  }
  .nx-banner {
    margin: 0 0 16px; padding: 12px 14px; border-radius: 10px; font-size: 14px;
    display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap;
  }
  .nx-banner.warn { background: #fff4d6; color: #5c4500; }
  .nx-banner.info { background: #eaf4ff; color: #004299; }
  .nx-banner a { color: inherit; font-weight: 700; }
`;

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M5 3.5v9l8-4.5-8-4.5z" fill="#4a1d6a" />
    </svg>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const welcomeName = data.shopName || "there";

  return (
    <s-page heading="Home">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-home">
        <h1 className="nx-welcome">Welcome {welcomeName}!</h1>

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

        <div className="nx-panel">
          <h2 className="nx-panel__title">See how your marketplace works</h2>
          <p className="nx-panel__sub">
            Everything you need to know about managing sellers, routing orders,
            and setting commissions.
          </p>
          <div className="nx-guides">
            <a className="nx-guide" href={data.vendorPortalUrl} target="_blank" rel="noreferrer">
              <div className="nx-guide__thumb">
                <div className="nx-guide__play">
                  <PlayIcon />
                </div>
                <span className="nx-guide__thumb-label">
                  See your seller&apos;s dashboard
                </span>
              </div>
              <p className="nx-guide__title">Seller portal overview</p>
              <p className="nx-guide__desc">
                See how sellers manage products, orders, and payouts from their
                portal.
              </p>
            </a>
            <Link className="nx-guide" to="/app/orders">
              <div className="nx-guide__thumb">
                <div className="nx-guide__play">
                  <PlayIcon />
                </div>
                <span className="nx-guide__thumb-label">
                  Order routing to sellers
                </span>
              </div>
              <p className="nx-guide__title">Assigning orders to your sellers</p>
              <p className="nx-guide__desc">
                See how orders are attributed to the right sellers automatically.
              </p>
            </Link>
            <Link className="nx-guide" to="/app/settings">
              <div className="nx-guide__thumb">
                <div className="nx-guide__play">
                  <PlayIcon />
                </div>
                <span className="nx-guide__thumb-label">
                  Set commission details for any seller
                </span>
              </div>
              <p className="nx-guide__title">Setting up seller commissions</p>
              <p className="nx-guide__desc">
                Set default commission rates and adjust them per seller.
              </p>
            </Link>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
