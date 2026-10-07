import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { buildShopReport } from "../services/reports.server";
import {
  REPORT_PERIODS,
  parseReportPeriod,
} from "../utils/report-period";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const period = parseReportPeriod(url.searchParams.get("period"));
  const report = await buildShopReport(admin, session.shop, period);
  return { report };
};

const styles = `
  .nx-reports { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-reports__head { margin-bottom: 18px; }
  .nx-reports__title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px; }
  .nx-reports__sub { margin: 0; color: #6d7175; font-size: 14px; }
  .nx-tabs { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
  .nx-tab {
    border: none; background: transparent; padding: 8px 14px; border-radius: 8px;
    font-size: 13px; font-weight: 600; color: #6d7175; cursor: pointer;
  }
  .nx-tab.is-active { background: #e4e5e7; color: #1a1a1a; }
  .nx-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .nx-metric {
    background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; padding: 18px 20px;
  }
  .nx-metric__label { font-size: 13px; color: #6d7175; margin: 0 0 10px; }
  .nx-metric__value { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .nx-metric__hint { margin: 8px 0 0; font-size: 12px; color: #8c9196; }
  .nx-note {
    margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: #f6f6f7;
    color: #5c5f62; font-size: 13px; line-height: 1.45;
  }
  @media (max-width: 900px) {
    .nx-metrics { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 560px) {
    .nx-metrics { grid-template-columns: 1fr; }
  }
`;

export default function AdminReportsPage() {
  const { report } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const period = parseReportPeriod(searchParams.get("period"));

  function setPeriod(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("period", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <s-page heading="Reports">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-reports">
        <div className="nx-reports__head">
          <h1 className="nx-reports__title">Reports</h1>
          <p className="nx-reports__sub">{report.rangeLabel}</p>
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

        <div className="nx-metrics">
          <div className="nx-metric">
            <p className="nx-metric__label">Revenue</p>
            <p className="nx-metric__value">
              {formatMoney(report.revenue, report.currency)}
            </p>
            <p className="nx-metric__hint">
              {report.orderCount} order{report.orderCount === 1 ? "" : "s"} in
              this period
            </p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Marketplace revenue</p>
            <p className="nx-metric__value">
              {formatMoney(report.marketplaceRevenue, report.currency)}
            </p>
            <p className="nx-metric__hint">Seller-attributed sales</p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Customers</p>
            <p className="nx-metric__value">{report.customers}</p>
            <p className="nx-metric__hint">
              Unique emails on orders in this period
            </p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">New products</p>
            <p className="nx-metric__value">{report.productsNew}</p>
            <p className="nx-metric__hint">Created in this period</p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Active products</p>
            <p className="nx-metric__value">{report.productsActive}</p>
            <p className="nx-metric__hint">Current catalog</p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Inventory</p>
            <p className="nx-metric__value">{report.inventoryUnits}</p>
            <p className="nx-metric__hint">
              Units in stock (marketplace products)
            </p>
          </div>
        </div>

        <div className="nx-note">
          Revenue and customers use Shopify orders for the selected period.
          Inventory and active products are current store totals. Customer count
          is based on unique order emails (up to the latest 100 orders sampled
          for uniqueness).
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
