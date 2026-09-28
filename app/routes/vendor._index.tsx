import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import {
  listAttributionsForVendor,
  salesSummaryForVendor,
} from "../models/attribution.server";
import { getVendorEarningsSummary } from "../models/payouts.server";
import { unauthenticated } from "../shopify.server";
import { listMarketplaceProducts } from "../services/products.server";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const [summary, attributions, earnings] = await Promise.all([
    salesSummaryForVendor(vendor.id),
    listAttributionsForVendor(vendor.id),
    getVendorEarningsSummary(vendor.id),
  ]);

  let productCount = 0;
  let activeCount = 0;
  let lowStock = 0;
  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    const products = await listMarketplaceProducts(admin, {
      vendorId: vendor.id,
      first: 50,
    });
    productCount = products.length;
    activeCount = products.filter(
      (p: { status?: string }) => String(p.status || "").toUpperCase() === "ACTIVE",
    ).length;
    lowStock = products.filter(
      (p: { totalInventory?: number | null }) =>
        (p.totalInventory ?? 0) > 0 && (p.totalInventory ?? 0) <= 5,
    ).length;
  } catch (error) {
    console.error("Vendor dashboard product fetch failed", error);
  }

  return {
    vendor,
    summary,
    earnings,
    recentOrders: attributions.slice(0, 5),
    productCount,
    activeCount,
    lowStock,
  };
};

export default function VendorDashboard() {
  const {
    vendor,
    summary,
    earnings,
    recentOrders,
    productCount,
    activeCount,
    lowStock,
  } = useLoaderData<typeof loader>();

  return (
    <div>
      <h1 className="sx-title">Welcome {vendor.name}!</h1>
      <p className="sx-sub">
        Manage your products, orders, and payouts from one place.
      </p>

      <div className="sx-panel">
        <h2 className="sx-panel__title">What do you want to do?</h2>
        <div className="sx-actions" style={{ marginTop: 12 }}>
          <Link className="sx-btn sx-btn--primary sx-btn--lg" to="/vendor/products/new">
            + Add a product
          </Link>
          <Link className="sx-btn sx-btn--lg" to="/vendor/products">
            My products
          </Link>
          <Link className="sx-btn sx-btn--lg" to="/vendor/orders">
            My orders
          </Link>
          <Link className="sx-btn sx-btn--lg" to="/vendor/earnings">
            My payouts
          </Link>
        </div>
        <p className="sx-secondary">
          Tip: on Add a product you can use a photo and speak the name and price.
        </p>
      </div>

      <div className="sx-metrics">
        <Link className="sx-metric" to="/vendor/products">
          <p className="sx-metric__label">Active products</p>
          <p className="sx-metric__value">{activeCount}</p>
        </Link>
        <Link className="sx-metric" to="/vendor/orders">
          <p className="sx-metric__label">Orders</p>
          <p className="sx-metric__value">{summary.orderCount}</p>
        </Link>
        <Link className="sx-metric" to="/vendor/sales">
          <p className="sx-metric__label">Revenue</p>
          <p className="sx-metric__value">
            {formatMoney(summary.revenue, summary.currency)}
          </p>
        </Link>
        <Link className="sx-metric" to="/vendor/earnings">
          <p className="sx-metric__label">Pending payout</p>
          <p className="sx-metric__value">
            {formatMoney(earnings.pending, earnings.currency)}
          </p>
        </Link>
      </div>

      {(lowStock > 0 || productCount === 0) && (
        <div className="sx-banner info">
          {productCount === 0
            ? "You have no products yet. Add your first product to start selling."
            : `${lowStock} product${lowStock === 1 ? "" : "s"} low on stock (5 or fewer).`}
        </div>
      )}

      <div className="sx-panel">
        <div className="sx-panel__head">
          <h2 className="sx-panel__title">Recent orders</h2>
          <Link className="sx-link" to="/vendor/orders">
            See all
          </Link>
        </div>
        {recentOrders.length === 0 ? (
          <div className="sx-empty">
            No orders yet. When customers buy your products, they show up here.
          </div>
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Total</th>
                  <th>Your net</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <p className="sx-primary">
                        {o.shopifyOrderName || o.shopifyOrderId}
                      </p>
                      <p className="sx-secondary">
                        {new Date(o.createdAt).toLocaleString()}
                      </p>
                    </td>
                    <td>{formatMoney(o.subtotal, o.currency)}</td>
                    <td>
                      {formatMoney(o.subtotal - o.commissionAmount, o.currency)}
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
