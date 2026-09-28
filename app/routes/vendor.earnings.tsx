import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
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
    commissionFlat:
      "commissionFlat" in result.vendor
        ? Number((result.vendor as { commissionFlat?: number }).commissionFlat ?? 0)
        : 0,
  };
};

export default function VendorEarnings() {
  const { summary, commissionPercent, commissionFlat } =
    useLoaderData<typeof loader>();

  return (
    <div>
      <h1 className="sx-title">Payouts</h1>
      <p className="sx-sub">
        Platform commission: {commissionPercent}%
        {commissionFlat > 0 ? ` + flat ${formatMoney(commissionFlat, summary.currency)} per order` : ""}.
        The store admin pays you outside Shopify (bank / GCash).
      </p>

      <div className="sx-metrics">
        <div className="sx-metric">
          <p className="sx-metric__label">Gross revenue</p>
          <p className="sx-metric__value">
            {formatMoney(summary.revenue, summary.currency)}
          </p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Platform commission</p>
          <p className="sx-metric__value">
            {formatMoney(summary.commission, summary.currency)}
          </p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Your earnings</p>
          <p className="sx-metric__value">
            {formatMoney(summary.earned, summary.currency)}
          </p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Pending payout</p>
          <p className="sx-metric__value">
            {formatMoney(summary.pending, summary.currency)}
          </p>
        </div>
      </div>

      <div className="sx-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 16px 0" }}>
          <h2 className="sx-panel__title">Payout history</h2>
        </div>
        {summary.payouts.length === 0 ? (
          <div className="sx-empty">No payouts recorded yet.</div>
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {summary.payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.paidAt).toISOString().slice(0, 10)}</td>
                    <td>{formatMoney(p.amount, p.currency)}</td>
                    <td>{p.reference || "—"}</td>
                    <td>{p.note || "—"}</td>
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
