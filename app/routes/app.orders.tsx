import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { useMemo, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listAttributionsForShop } from "../models/attribution.server";
import { syncRecentOrders } from "../services/commission.server";
import { formatMoney } from "../utils/money";

type ShopifyOrderRow = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  customerName: string;
  customerEmail: string;
  total: number;
  currency: string;
  itemCount: number;
  delivery: string;
};

async function fetchShopifyOrders(admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}): Promise<ShopifyOrderRow[]> {
  const response = await admin.graphql(
    `#graphql
    query marketplaceOrdersList($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          createdAt
          cancelledAt
          displayFulfillmentStatus
          displayFinancialStatus
          currencyCode
          currentTotalPriceSet {
            shopMoney { amount currencyCode }
          }
          customer {
            displayName
            defaultEmailAddress { emailAddress }
          }
          shippingAddress {
            name
          }
          fulfillments(first: 5) {
            nodes {
              status
              trackingInfo { company number }
            }
          }
          lineItems(first: 50) {
            nodes { quantity }
          }
        }
      }
    }`,
    { variables: { first: 50 } },
  );
  const json = await response.json();
  const nodes = json.data?.orders?.nodes ?? [];

  return nodes.map(
    (o: {
      id: string;
      name?: string;
      createdAt?: string;
      cancelledAt?: string | null;
      displayFulfillmentStatus?: string;
      displayFinancialStatus?: string;
      currencyCode?: string;
      currentTotalPriceSet?: {
        shopMoney?: { amount?: string; currencyCode?: string };
      };
      customer?: {
        displayName?: string;
        defaultEmailAddress?: { emailAddress?: string } | null;
      } | null;
      shippingAddress?: { name?: string } | null;
      fulfillments?: {
        nodes?: Array<{
          status?: string;
          trackingInfo?: Array<{ company?: string; number?: string }>;
        }>;
      };
      lineItems?: { nodes?: Array<{ quantity?: number }> };
    }) => {
      const itemCount = (o.lineItems?.nodes ?? []).reduce(
        (sum, li) => sum + (li.quantity ?? 0),
        0,
      );
      const fulfillment = o.fulfillments?.nodes?.[0];
      const tracking = fulfillment?.trackingInfo?.[0];
      let delivery = "—";
      if (o.cancelledAt) {
        delivery = "Cancelled";
      } else if (tracking?.number) {
        delivery = tracking.company
          ? `${tracking.company} ${tracking.number}`
          : tracking.number;
      } else if (fulfillment?.status) {
        delivery = titleCase(fulfillment.status.replace(/_/g, " "));
      } else if (
        String(o.displayFulfillmentStatus || "").toUpperCase() === "UNFULFILLED"
      ) {
        delivery = "Requested";
      }

      return {
        id: o.id,
        name: o.name || o.id,
        createdAt: o.createdAt || "",
        cancelledAt: o.cancelledAt ?? null,
        displayFulfillmentStatus: o.displayFulfillmentStatus || "UNFULFILLED",
        displayFinancialStatus: o.displayFinancialStatus || "PENDING",
        customerName:
          o.customer?.displayName ||
          o.shippingAddress?.name ||
          "Guest",
        customerEmail:
          o.customer?.defaultEmailAddress?.emailAddress || "",
        total: Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0),
        currency:
          o.currentTotalPriceSet?.shopMoney?.currencyCode ||
          o.currencyCode ||
          "USD",
        itemCount,
        delivery,
      };
    },
  );
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function formatCreatedOn(iso: string) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function fulfillmentLabel(status: string) {
  const s = status.toUpperCase();
  if (s === "UNFULFILLED") return "Unfulfilled";
  if (s === "FULFILLED") return "Fulfilled";
  if (s === "PARTIAL") return "Partially fulfilled";
  if (s === "IN_PROGRESS") return "In progress";
  if (s === "ON_HOLD") return "On hold";
  if (s === "SCHEDULED") return "Scheduled";
  return titleCase(status.replace(/_/g, " "));
}

function paymentLabel(status: string) {
  const s = status.toUpperCase();
  if (s === "PENDING" || s === "AUTHORIZED") return "Payment pending";
  if (s === "PAID") return "Paid";
  if (s === "PARTIALLY_PAID") return "Partially paid";
  if (s === "REFUNDED") return "Refunded";
  if (s === "VOIDED") return "Voided";
  if (s === "EXPIRED") return "Expired";
  return titleCase(status.replace(/_/g, " "));
}

function badgeTone(kind: "fulfillment" | "payment", status: string) {
  const s = status.toUpperCase();
  if (kind === "fulfillment") {
    if (s === "FULFILLED") return "ok";
    if (s === "UNFULFILLED" || s === "PARTIAL") return "warn";
    return "neutral";
  }
  if (s === "PAID") return "ok";
  if (s === "PENDING" || s === "AUTHORIZED" || s === "PARTIALLY_PAID")
    return "warn";
  return "neutral";
}

const styles = `
  .nx-orders { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-orders__title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 18px; }
  .nx-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
  .nx-tab {
    border: none; background: transparent; padding: 8px 14px; border-radius: 8px;
    font-size: 13px; font-weight: 600; color: #6d7175; cursor: pointer;
  }
  .nx-tab.is-active { background: #e4e5e7; color: #1a1a1a; }
  .nx-search-row { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; }
  .nx-search {
    flex: 1; display: flex; align-items: center; gap: 8px;
    border: 1px solid #c9cccf; border-radius: 10px; background: #fff; padding: 10px 12px;
  }
  .nx-search input {
    border: none; outline: none; width: 100%; font-size: 14px; background: transparent;
  }
  .nx-sync { border: 1px solid #c9cccf; background: #fff; border-radius: 8px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .nx-table-wrap {
    background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; overflow: hidden;
  }
  .nx-table { width: 100%; border-collapse: collapse; }
  .nx-table th {
    text-align: left; font-size: 12px; font-weight: 600; color: #6d7175;
    padding: 12px 16px; border-bottom: 1px solid #e4e5e7; background: #fafbfb;
  }
  .nx-table td {
    padding: 14px 16px; border-bottom: 1px solid #ececec; vertical-align: top; font-size: 13px;
  }
  .nx-table tr:last-child td { border-bottom: none; }
  .nx-primary { font-weight: 700; margin: 0 0 2px; }
  .nx-secondary { margin: 0; color: #6d7175; font-size: 12px; }
  .nx-badge {
    display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; white-space: nowrap;
  }
  .nx-badge.warn { background: #fff4d6; color: #8a6d00; }
  .nx-badge.ok { background: #e4f7e9; color: #0d6b2d; }
  .nx-badge.neutral { background: #f1f2f3; color: #5c5f62; }
  .nx-empty { padding: 28px 16px; text-align: center; color: #6d7175; }
  .nx-sellers { margin: 4px 0 0; font-size: 12px; color: #6d7175; }
  .nx-banner { margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
  .nx-banner.err { background: #fbeae9; color: #8e1f0b; }
  .nx-banner.ok { background: #e4f7e9; color: #0d6b2d; }
  @media (max-width: 900px) {
    .nx-table-wrap { overflow-x: auto; }
    .nx-table { min-width: 860px; }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  let syncError: string | null = null;
  try {
    await syncRecentOrders(session.shop, admin, 25);
  } catch (error) {
    console.error("Auto order sync failed", error);
    syncError =
      error instanceof Error ? error.message : "Failed to sync recent orders.";
  }

  const [orders, attributions] = await Promise.all([
    fetchShopifyOrders(admin).catch((error) => {
      console.error("Failed to load Shopify orders", error);
      return [] as ShopifyOrderRow[];
    }),
    listAttributionsForShop(session.shop),
  ]);

  const sellersByOrder: Record<string, string[]> = {};
  for (const row of attributions) {
    const list = sellersByOrder[row.shopifyOrderId] ?? [];
    if (!list.includes(row.vendor.name)) list.push(row.vendor.name);
    sellersByOrder[row.shopifyOrderId] = list;
  }

  return { orders, sellersByOrder, syncError };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "sync") {
    return { error: "Unknown action." };
  }

  try {
    const result = await syncRecentOrders(session.shop, admin);
    return {
      ok: true,
      message: `Synced ${result.processed} recent order(s) from Shopify.`,
    };
  } catch (error) {
    console.error("Order sync failed", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to sync orders. Check read_orders scope / protected customer data.",
    };
  }
};

export default function AdminOrdersPage() {
  const { orders, sellersByOrder, syncError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const tab = (searchParams.get("tab") || "all").toLowerCase();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (tab === "unfulfilled") {
        if (order.cancelledAt) return false;
        if (order.displayFulfillmentStatus.toUpperCase() !== "UNFULFILLED")
          return false;
      }
      if (tab === "cancelled") {
        if (!order.cancelledAt) return false;
      }
      if (!q) return true;
      const sellers = (sellersByOrder[order.id] || []).join(" ").toLowerCase();
      return (
        order.name.toLowerCase().includes(q) ||
        order.customerName.toLowerCase().includes(q) ||
        order.customerEmail.toLowerCase().includes(q) ||
        sellers.includes(q)
      );
    });
  }, [orders, query, sellersByOrder, tab]);

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <s-page heading="Orders">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-orders">
        <h1 className="nx-orders__title">Orders</h1>

        {syncError && <div className="nx-banner err">{syncError}</div>}
        {actionData && "error" in actionData && actionData.error && (
          <div className="nx-banner err">{actionData.error}</div>
        )}
        {actionData && "message" in actionData && actionData.message && (
          <div className="nx-banner ok">{actionData.message}</div>
        )}

        <div className="nx-tabs">
          {[
            { id: "all", label: "All" },
            { id: "unfulfilled", label: "Unfulfilled" },
            { id: "cancelled", label: "Cancelled" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className={`nx-tab${tab === t.id ? " is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="nx-search-row">
          <div className="nx-search">
            <span aria-hidden>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your orders using order id, customer name, email or phone"
            />
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="sync" />
            <button className="nx-sync" type="submit" disabled={busy}>
              {busy ? "Syncing…" : "Sync"}
            </button>
          </Form>
        </div>

        <div className="nx-table-wrap">
          {filtered.length === 0 ? (
            <div className="nx-empty">
              No orders found. Place a checkout on the store, then click Sync.
            </div>
          ) : (
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Fulfillment</th>
                  <th>Payment</th>
                  <th>Delivery</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => {
                  const sellers = sellersByOrder[order.id] || [];
                  const fTone = badgeTone(
                    "fulfillment",
                    order.displayFulfillmentStatus,
                  );
                  const pTone = badgeTone(
                    "payment",
                    order.displayFinancialStatus,
                  );
                  return (
                    <tr key={order.id}>
                      <td>
                        <p className="nx-primary">{order.name}</p>
                        <p className="nx-secondary">
                          Created on {formatCreatedOn(order.createdAt)}
                        </p>
                        {sellers.length > 0 && (
                          <p className="nx-sellers">
                            Seller{sellers.length > 1 ? "s" : ""}:{" "}
                            {sellers.join(", ")}
                          </p>
                        )}
                      </td>
                      <td>
                        <p className="nx-primary">{order.customerName}</p>
                        <p className="nx-secondary">
                          {order.customerEmail || "—"}
                        </p>
                      </td>
                      <td>
                        <p className="nx-primary">
                          {formatMoney(order.total, order.currency)}
                        </p>
                        <p className="nx-secondary">
                          {order.itemCount} Item
                          {order.itemCount === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td>
                        <span className={`nx-badge ${fTone}`}>
                          {fulfillmentLabel(order.displayFulfillmentStatus)}
                        </span>
                      </td>
                      <td>
                        <span className={`nx-badge ${pTone}`}>
                          {paymentLabel(order.displayFinancialStatus)}
                        </span>
                      </td>
                      <td>{order.delivery}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
