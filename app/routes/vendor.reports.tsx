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

  function setPeriod(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("period", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <div>
      <h1 className="sx-title">Reports</h1>
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <div className="sx-panel">
          <p className="sx-metric__label">Revenue</p>
          <p className="sx-metric__value">
            {formatMoney(report.revenue, report.currency)}
          </p>
          <p className="sx-secondary" style={{ marginTop: 6 }}>
            {report.orderCount} order{report.orderCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="sx-panel">
          <p className="sx-metric__label">Customers</p>
          <p className="sx-metric__value">{report.customers}</p>
          <p className="sx-secondary" style={{ marginTop: 6 }}>
            Unique buyers this period
          </p>
        </div>
        <div className="sx-panel">
          <p className="sx-metric__label">Products</p>
          <p className="sx-metric__value">{report.productsActive}</p>
          <p className="sx-secondary" style={{ marginTop: 6 }}>
            Active products
          </p>
        </div>
        <div className="sx-panel">
          <p className="sx-metric__label">Inventory</p>
          <p className="sx-metric__value">{report.inventoryUnits}</p>
          <p className="sx-secondary" style={{ marginTop: 6 }}>
            Units in stock
          </p>
        </div>
      </div>

      <div className="sx-banner info" style={{ marginTop: 16 }}>
        Switch Daily / Weekly / Monthly / Yearly to update revenue, orders, and
        customers. Product and inventory counts are your current catalog.
      </div>
    </div>
  );
}
