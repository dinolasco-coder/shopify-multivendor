import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { buildShopAnalytics } from "../services/reports.server";
import {
  REPORT_PERIODS,
  parseReportPeriod,
} from "../utils/report-period";
import { formatMoney } from "../utils/money";

function appBaseUrl(request: Request) {
  return (
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, scopes } = await authenticate.admin(request);
  const url = new URL(request.url);
  const period = parseReportPeriod(url.searchParams.get("period"));
  const analytics = await buildShopAnalytics(admin, session.shop, period);

  const scopesConfigured = (process.env.SCOPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let sessionScopes = (session.scope || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const detail = await scopes.query();
    if (detail.granted?.length) sessionScopes = detail.granted;
  } catch {
    // keep session.scope
  }

  const envHasReports = scopesConfigured.includes("read_reports");
  const sessionHasReports = sessionScopes.includes("read_reports");
  const base = appBaseUrl(request);
  const reauthFullUrl = `${base}/reauth?shop=${encodeURIComponent(session.shop)}&mode=full`;

  return {
    analytics,
    envHasReports,
    sessionHasReports,
    reauthFullUrl,
    partnerPcdUrl:
      "https://partners.shopify.com/?hint=protected-customer-data",
    pcdDocsUrl:
      "https://shopify.dev/docs/apps/launch/protected-customer-data",
  };
};

function formatChange(pct: number | null) {
  if (pct == null || Number.isNaN(pct)) return null;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

const styles = `
  .nx-an { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-an__head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 16px; }
  .nx-an__title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .nx-an__sub { margin: 0; color: #6d7175; font-size: 14px; }
  .nx-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .nx-tab {
    border: 1px solid #c9cccf; background: #fff; padding: 8px 12px; border-radius: 8px;
    font-size: 13px; font-weight: 600; color: #5c5f62; cursor: pointer;
  }
  .nx-tab.is-active { background: #1a1a1a; border-color: #1a1a1a; color: #fff; }
  .nx-banner {
    margin-bottom: 14px; padding: 12px 14px; border-radius: 10px; font-size: 13px;
    background: #fff4d6; color: #5c4500; line-height: 1.45;
  }
  .nx-banner ol { margin: 8px 0 12px; padding-left: 18px; }
  .nx-banner li { margin: 4px 0; }
  .nx-banner__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .nx-btn {
    display: inline-flex; align-items: center; border-radius: 8px; padding: 9px 12px;
    font-size: 13px; font-weight: 600; text-decoration: none; border: 1px solid #c9cccf;
    background: #fff; color: #202223;
  }
  .nx-btn--primary { background: #1a1a1a; border-color: #1a1a1a; color: #fff; }
  .nx-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
  .nx-metric {
    background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; padding: 16px 18px;
  }
  .nx-metric__label { font-size: 13px; color: #6d7175; margin: 0 0 8px; }
  .nx-metric__value { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .nx-metric__change { margin: 8px 0 0; font-size: 12px; font-weight: 600; }
  .nx-metric__change.up { color: #0d6b2d; }
  .nx-metric__change.down { color: #8e1f0b; }
  .nx-metric__hint { margin: 6px 0 0; font-size: 12px; color: #8c9196; }
  .nx-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 12px; margin-bottom: 12px; }
  .nx-panel {
    background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; padding: 18px;
  }
  .nx-panel__title { margin: 0 0 14px; font-size: 15px; font-weight: 700; }
  .nx-chart {
    display: flex; align-items: flex-end; gap: 6px; height: 180px; padding-top: 8px;
  }
  .nx-chart__col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
  .nx-chart__bar {
    width: 100%; max-width: 36px; border-radius: 6px 6px 2px 2px; background: #2c6ecb; min-height: 2px;
  }
  .nx-chart__label {
    margin-top: 6px; font-size: 10px; color: #6d7175; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
  }
  .nx-table { width: 100%; border-collapse: collapse; }
  .nx-table th {
    text-align: left; font-size: 12px; color: #6d7175; font-weight: 600;
    padding: 8px 0; border-bottom: 1px solid #e4e5e7;
  }
  .nx-table td { padding: 10px 0; border-bottom: 1px solid #ececec; font-size: 13px; }
  .nx-table tr:last-child td { border-bottom: none; }
  .nx-secondary { color: #6d7175; font-size: 12px; }
  .nx-note { margin-top: 4px; font-size: 12px; color: #8c9196; line-height: 1.45; }
  @media (max-width: 980px) {
    .nx-metrics { grid-template-columns: 1fr 1fr; }
    .nx-grid { grid-template-columns: 1fr; }
  }
`;

export default function AdminAnalyticsPage() {
  const {
    analytics,
    envHasReports,
    sessionHasReports,
    reauthFullUrl,
    pcdDocsUrl,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const period = parseReportPeriod(searchParams.get("period"));
  const change = formatChange(analytics.salesChangePercent);
  const maxSales = Math.max(1, ...analytics.series.map((p) => p.sales));
  const needsSetup =
    analytics.source === "fallback" || !envHasReports || !sessionHasReports;

  function setPeriod(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("period", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <s-page heading="Analytics">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-an">
        <div className="nx-an__head">
          <div>
            <h1 className="nx-an__title">Analytics</h1>
            <p className="nx-an__sub">{analytics.rangeLabel}</p>
          </div>
          <div className="nx-tabs">
            {REPORT_PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`nx-tab${period === p.id ? " is-active" : ""}`}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {needsSetup ? (
          <div className="nx-banner">
            <strong>Enable Shopify Analytics (same as Admin)</strong>
            <ol>
              <li>
                Railway → your service → Variables → set{" "}
                <code>SCOPES</code> to include <code>read_reports</code>, then
                redeploy.
                {!envHasReports ? (
                  <em> (Server SCOPES is still missing read_reports.)</em>
                ) : null}
              </li>
              <li>
                Click <strong>Authorize reports access</strong> below and approve
                the new permission in Shopify.
                {!sessionHasReports ? (
                  <em> (This shop has not granted read_reports yet.)</em>
                ) : null}
              </li>
              <li>
                Partners dashboard → your app → <strong>API access</strong> →{" "}
                <strong>Protected customer data</strong> → request{" "}
                <strong>Level 2</strong> (name, address, phone, email). Shopify
                must approve this before ShopifyQL analytics works.
              </li>
            </ol>
            Showing order-based totals until both are granted.
            <div className="nx-banner__actions">
              <a
                className="nx-btn nx-btn--primary"
                href={reauthFullUrl}
                target="_top"
              >
                Authorize reports access
              </a>
              <a className="nx-btn" href={pcdDocsUrl} target="_blank" rel="noreferrer">
                Protected customer data guide
              </a>
            </div>
          </div>
        ) : null}

        <div className="nx-metrics">
          <div className="nx-metric">
            <p className="nx-metric__label">Total sales</p>
            <p className="nx-metric__value">
              {formatMoney(analytics.totalSales, analytics.currency)}
            </p>
            {change ? (
              <p
                className={`nx-metric__change ${
                  (analytics.salesChangePercent || 0) >= 0 ? "up" : "down"
                }`}
              >
                {change} vs previous period
              </p>
            ) : (
              <p className="nx-metric__hint">Compared to previous period</p>
            )}
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Orders</p>
            <p className="nx-metric__value">{analytics.orders}</p>
            <p className="nx-metric__hint">
              Prev: {analytics.previousOrders || "—"}
            </p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Average order value</p>
            <p className="nx-metric__value">
              {formatMoney(analytics.averageOrderValue, analytics.currency)}
            </p>
            <p className="nx-metric__hint">Per order</p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Customers</p>
            <p className="nx-metric__value">{analytics.customers}</p>
            <p className="nx-metric__hint">
              {analytics.returningCustomerRate != null
                ? `${analytics.returningCustomerRate.toFixed(1)}% returning`
                : "Buyers in this period"}
            </p>
          </div>
        </div>

        <div className="nx-metrics">
          <div className="nx-metric">
            <p className="nx-metric__label">Marketplace sales</p>
            <p className="nx-metric__value">
              {formatMoney(analytics.marketplaceRevenue, analytics.currency)}
            </p>
            <p className="nx-metric__hint">Seller-attributed</p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Products</p>
            <p className="nx-metric__value">{analytics.productsActive}</p>
            <p className="nx-metric__hint">
              {analytics.productsNew} new in period
            </p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Inventory</p>
            <p className="nx-metric__value">{analytics.inventoryUnits}</p>
            <p className="nx-metric__hint">Units in stock</p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Data source</p>
            <p className="nx-metric__value" style={{ fontSize: 18 }}>
              {analytics.source === "shopifyql" ? "ShopifyQL" : "Orders"}
            </p>
            <p className="nx-metric__hint">Same engine as Shopify Admin</p>
          </div>
        </div>

        <div className="nx-grid">
          <div className="nx-panel">
            <h2 className="nx-panel__title">Total sales over time</h2>
            {analytics.series.length === 0 ? (
              <p className="nx-secondary">No sales in this period.</p>
            ) : (
              <div className="nx-chart">
                {analytics.series.map((point) => (
                  <div className="nx-chart__col" key={point.label + point.sales}>
                    <div
                      className="nx-chart__bar"
                      title={formatMoney(point.sales, analytics.currency)}
                      style={{
                        height: `${Math.max(4, (point.sales / maxSales) * 100)}%`,
                      }}
                    />
                    <div className="nx-chart__label">{point.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="nx-panel">
            <h2 className="nx-panel__title">Top products</h2>
            {analytics.topProducts.length === 0 ? (
              <p className="nx-secondary">
                No product ranking yet for this period.
              </p>
            ) : (
              <table className="nx-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Net sales</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.topProducts.map((row) => (
                    <tr key={row.title}>
                      <td>{row.title}</td>
                      <td>
                        {formatMoney(row.netSales, analytics.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <p className="nx-note">
          Metrics use Shopify Analytics (ShopifyQL) when available — the same
          reporting data as Shopify Admin → Analytics. Inventory and marketplace
          sales come from your multivendor catalog and seller attributions.
        </p>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
