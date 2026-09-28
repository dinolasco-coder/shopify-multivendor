import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
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

export default function VendorSales() {
  const { summary, attributions, commissionPercent } =
    useLoaderData<typeof loader>();

  return (
    <div>
      <h1 className="sx-title">Sales</h1>
      <p className="sx-sub">
        Your order history and earnings after the {commissionPercent}% platform
        commission.
      </p>

      <div className="sx-metrics">
        <div className="sx-metric">
          <p className="sx-metric__label">Orders</p>
          <p className="sx-metric__value">{summary.orderCount}</p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Gross revenue</p>
          <p className="sx-metric__value">
            {formatMoney(summary.revenue, summary.currency)}
          </p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Commission</p>
          <p className="sx-metric__value">
            {formatMoney(summary.commission, summary.currency)}
          </p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Your earnings</p>
          <p className="sx-metric__value">
            {formatMoney(summary.vendorEarnings, summary.currency)}
          </p>
        </div>
      </div>

      <div className="sx-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 16px 0" }}>
          <h2 className="sx-panel__title">Order history</h2>
        </div>
        {attributions.length === 0 ? (
          <div className="sx-empty">No sales recorded yet.</div>
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Subtotal</th>
                  <th>Commission</th>
                  <th>You earn</th>
                </tr>
              </thead>
              <tbody>
                {attributions.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <p className="sx-primary">
                        {row.shopifyOrderName || row.shopifyOrderId}
                      </p>
                      <p className="sx-secondary">
                        {new Date(row.createdAt).toLocaleString()}
                      </p>
                    </td>
                    <td>{formatMoney(row.subtotal, row.currency)}</td>
                    <td>{formatMoney(row.commissionAmount, row.currency)}</td>
                    <td>
                      {formatMoney(
                        row.subtotal - row.commissionAmount,
                        row.currency,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
