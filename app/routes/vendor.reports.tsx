import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { unauthenticated } from "../shopify.server";
import { buildVendorReport } from "../services/reports.server";
import {
  REPORT_PERIODS,
  parseReportPeriod,
} from "../utils/report-period";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const url = new URL(request.url);
  const period = parseReportPeriod(url.searchParams.get("period"));
  const { admin } = await unauthenticated.admin(vendor.shop);
  const report = await buildVendorReport(
    admin,
    vendor.shop,
    vendor.id,
    period,
  );

  return { report };
};

export default function VendorReportsPage() {
  const { report } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const period = parseReportPeriod(searchParams.get("period"));
  const maxSales = Math.max(1, ...report.series.map((p) => p.sales));

  function setPeriod(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("period", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <div>
      <h1 className="sx-title">Analytics</h1>
      <p className="sx-sub">{report.rangeLabel}</p>

      <div className="sx-tabs" style={{ marginBottom: 16 }}>
        {REPORT_PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`sx-tab${period === p.id ? " is-active" : ""}`}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="sx-metrics">
        <div className="sx-metric">
          <p className="sx-metric__label">Total sales</p>
          <p className="sx-metric__value">
            {formatMoney(report.revenue, report.currency)}
          </p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Orders</p>
          <p className="sx-metric__value">{report.orderCount}</p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Average order value</p>
          <p className="sx-metric__value">
            {formatMoney(report.averageOrderValue, report.currency)}
          </p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Customers</p>
          <p className="sx-metric__value">{report.customers}</p>
        </div>
      </div>

      <div className="sx-metrics">
        <div className="sx-metric">
          <p className="sx-metric__label">Products</p>
          <p className="sx-metric__value">{report.productsActive}</p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Inventory</p>
          <p className="sx-metric__value">{report.inventoryUnits}</p>
        </div>
      </div>

      <div className="sx-panel" style={{ marginTop: 4 }}>
        <h2 className="sx-panel__title">Sales over time</h2>
        {report.series.length === 0 ? (
          <p className="sx-secondary">No sales in this period.</p>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              height: 160,
              marginTop: 12,
            }}
          >
            {report.series.map((point) => (
              <div
                key={point.label}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  alignItems: "center",
                }}
              >
                <div
                  title={formatMoney(point.sales, report.currency)}
                  style={{
                    width: "100%",
                    maxWidth: 32,
                    borderRadius: "6px 6px 2px 2px",
                    background: "#2c6ecb",
                    height: `${Math.max(4, (point.sales / maxSales) * 100)}%`,
                  }}
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 10,
                    color: "#6d7175",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%",
                  }}
                >
                  {point.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
