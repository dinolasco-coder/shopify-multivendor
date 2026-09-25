import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useMemo, useState } from "react";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { listAttributionsForVendor } from "../models/attribution.server";
import { formatMoney } from "../utils/money";
import { unauthenticated } from "../shopify.server";

type OrderStatusMap = Record<
  string,
  {
    fulfillment: string;
    financial: string;
    adminUrl: string;
  }
>;

async function fetchOrderStatuses(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  orderIds: string[],
  shop: string,
): Promise<OrderStatusMap> {
  const unique = [...new Set(orderIds)].slice(0, 40);
  const map: OrderStatusMap = {};
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");

  await Promise.all(
    unique.map(async (id) => {
      try {
        const response = await admin.graphql(
          `#graphql
          query vendorOrderStatus($id: ID!) {
            order(id: $id) {
              id
              displayFulfillmentStatus
              displayFinancialStatus
            }
          }`,
          { variables: { id } },
        );
        const json = await response.json();
        const order = json.data?.order;
        if (!order) return;
        const numeric = String(order.id).split("/").pop();
        map[id] = {
          fulfillment: order.displayFulfillmentStatus || "UNFULFILLED",
          financial: order.displayFinancialStatus || "PENDING",
          adminUrl: `https://admin.shopify.com/store/${shopHandle}/orders/${numeric}`,
        };
      } catch (error) {
        console.error("vendor order status failed", id, error);
      }
    }),
  );

  return map;
}

function labelStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const attributions = await listAttributionsForVendor(vendor.id);
  let statuses: OrderStatusMap = {};
  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    statuses = await fetchOrderStatuses(
      admin,
      attributions.map((a) => a.shopifyOrderId),
      vendor.shop,
    );
  } catch (error) {
    console.error("Failed loading order statuses for vendor", error);
  }

  return { attributions, statuses };
};

export default function VendorOrders() {
  const { attributions, statuses } = useLoaderData<typeof loader>();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return attributions.filter((order) => {
      const status = statuses[order.shopifyOrderId];
      const fulfillment = (status?.fulfillment || "").toUpperCase();
      if (tab === "unfulfilled" && fulfillment !== "UNFULFILLED") return false;
      if (tab === "fulfilled" && fulfillment !== "FULFILLED") return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      const name = (order.shopifyOrderName || order.shopifyOrderId).toLowerCase();
      return name.includes(q);
    });
  }, [attributions, statuses, tab, query]);

  return (
    <div>
      <h1 className="sx-title">Orders</h1>
      <p className="sx-sub">
        View your orders, print invoices, and fulfill in Shopify when needed.
      </p>

      <div className="sx-banner info">
        Fulfillment is done in Shopify Admin (or your courier app). Use{" "}
        <strong>Open in Shopify</strong> then print an invoice for your records.
      </div>

      <div className="sx-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px" }}>
          <div className="sx-tabs">
            {[
              { id: "all", label: "All" },
              { id: "unfulfilled", label: "Unfulfilled" },
              { id: "fulfilled", label: "Fulfilled" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                className={`sx-tab${tab === t.id ? " is-active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="sx-search">
            <span aria-hidden>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search orders by order id"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="sx-empty">No orders with your products yet.</div>
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Total</th>
                  <th>Fulfillment</th>
                  <th>Payment</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => {
                  const items = JSON.parse(order.lineItemsJson || "[]") as Array<{
                    title: string;
                    quantity: number;
                  }>;
                  const status = statuses[order.shopifyOrderId];
                  const fulfillment = status?.fulfillment || "UNFULFILLED";
                  const financial = status?.financial || "PENDING";
                  return (
                    <tr key={order.id}>
                      <td>
                        <p className="sx-primary">
                          {order.shopifyOrderName || order.shopifyOrderId}
                        </p>
                        <p className="sx-secondary">
                          {new Date(order.createdAt).toLocaleString()}
                        </p>
                        <p className="sx-secondary">
                          {items
                            .map((i) => `${i.title} × ${i.quantity}`)
                            .join(" · ")}
                        </p>
                      </td>
                      <td>
                        <p className="sx-primary">
                          {formatMoney(order.subtotal, order.currency)}
                        </p>
                        <p className="sx-secondary">
                          Net{" "}
                          {formatMoney(
                            order.subtotal - order.commissionAmount,
                            order.currency,
                          )}
                        </p>
                      </td>
                      <td>
                        <span
                          className={`sx-badge ${
                            fulfillment === "FULFILLED" ? "ok" : "warn"
                          }`}
                        >
                          {labelStatus(fulfillment)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`sx-badge ${
                            financial === "PAID" ? "ok" : "warn"
                          }`}
                        >
                          {labelStatus(financial)}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {status?.adminUrl && (
                            <a
                              className="sx-btn"
                              href={status.adminUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open in Shopify
                            </a>
                          )}
                          <Link
                            className="sx-btn sx-btn--primary"
                            to={`/vendor/invoice/${order.id}`}
                            target="_blank"
                          >
                            Invoice
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
