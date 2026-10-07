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

function shopifyAdminPath(path: string) {
  const clean = path.replace(/^\//, "");
  return `shopify://admin/${clean}`;
}

function shopifyOrderAdminUrl(orderGid: string) {
  const numericId = orderGid.split("/").pop() || "";
  return shopifyAdminPath(`orders/${numericId}`);
}

type ShopifyOrderRow = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  /** Lowercased blob for client search (order #, customer, products, vendors). */
  searchText: string;
  total: number;
  currency: string;
  itemCount: number;
  delivery: string;
};

async function fetchShopifyOrders(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  options?: { query?: string; first?: number },
): Promise<ShopifyOrderRow[]> {
  const response = await admin.graphql(
    `#graphql
    query marketplaceOrdersList($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          createdAt
          cancelledAt
          displayFulfillmentStatus
          displayFinancialStatus
          currencyCode
          email
          phone
          currentTotalPriceSet {
            shopMoney { amount currencyCode }
          }
          shippingAddress {
            name
            phone
            company
            address1
            address2
            city
            province
            zip
            country
          }
          # fulfillments is a list, not a connection (no nodes)
          fulfillments(first: 5) {
            status
            trackingInfo { company number }
          }
          lineItems(first: 50) {
            nodes {
              quantity
              title
              variantTitle
              vendor
              sku
              name
            }
          }
        }
      }
    }`,
    {
      variables: {
        first: options?.first ?? 100,
        query: options?.query || null,
      },
    },
  );
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(
      json.errors.map((e: { message: string }) => e.message).join(", "),
    );
  }
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
      email?: string | null;
      phone?: string | null;
      currentTotalPriceSet?: {
        shopMoney?: { amount?: string; currencyCode?: string };
      };
      shippingAddress?: {
        name?: string;
        phone?: string | null;
        company?: string | null;
        address1?: string | null;
        address2?: string | null;
        city?: string | null;
        province?: string | null;
        zip?: string | null;
        country?: string | null;
      } | null;
      fulfillments?: Array<{
        status?: string;
        trackingInfo?: Array<{ company?: string; number?: string }>;
      }>;
      lineItems?: {
        nodes?: Array<{
          quantity?: number;
          title?: string | null;
          variantTitle?: string | null;
          vendor?: string | null;
          sku?: string | null;
          name?: string | null;
        }>;
      };
    }) => {
      const lineNodes = o.lineItems?.nodes ?? [];
      const itemCount = lineNodes.reduce(
        (sum, li) => sum + (li.quantity ?? 0),
        0,
      );
      const fulfillment = o.fulfillments?.[0];
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

      const name = o.name || o.id;
      // Avoid Order.customer (needs read_customers). Use order + shipping fields.
      const customerName = o.shippingAddress?.name || "Guest";
      const customerEmail = o.email || "";
      const customerPhone = o.phone || o.shippingAddress?.phone || "";
      const ship = o.shippingAddress;
      const cityLine = ship
        ? [ship.city, ship.province, ship.zip].filter(Boolean).join(", ")
        : "";
      const customerAddress = ship
        ? [ship.company, ship.address1, ship.address2, cityLine, ship.country]
            .filter(Boolean)
            .join("\n")
        : "";
      const productBits = lineNodes
        .flatMap((li) => [
          li.name,
          li.title,
          li.variantTitle,
          li.vendor,
          li.sku,
        ])
        .filter(Boolean)
        .join(" ");
      const searchText = [
        name,
        name.replace(/^#/, ""),
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        productBits,
        delivery,
        tracking?.number,
        tracking?.company,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        id: o.id,
        name,
        createdAt: o.createdAt || "",
        cancelledAt: o.cancelledAt ?? null,
        displayFulfillmentStatus: o.displayFulfillmentStatus || "UNFULFILLED",
        displayFinancialStatus: o.displayFinancialStatus || "PENDING",
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        searchText,
        total: Number(o.currentTotalPriceSet?.shopMoney?.amount ?? 0),
        currency:
          o.currentTotalPriceSet?.shopMoney?.currencyCode ||
          o.currencyCode ||
          "PHP",
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
  .nx-orders__head {
    display: flex; justify-content: space-between; gap: 12px; align-items: flex-start;
    margin-bottom: 18px; flex-wrap: wrap;
  }
  .nx-orders__title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .nx-orders__actions { display: flex; gap: 8px; align-items: center; }
  .nx-link-btn {
    border: 1px solid #c9cccf; background: #fff; color: #202223; border-radius: 8px;
    padding: 8px 12px; font-size: 13px; font-weight: 600; text-decoration: none;
    display: inline-flex; align-items: center;
  }
  .nx-order-link { font-weight: 700; color: #1a1a1a; text-decoration: none; }
  .nx-order-link:hover { text-decoration: underline; }
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

function orderSearchQueryForTab(tab: string) {
  if (tab === "unfulfilled") {
    // Same as Shopify Admin → Orders → Unfulfilled.
    return "status:open fulfillment_status:unfulfilled";
  }
  if (tab === "cancelled") {
    return "status:cancelled";
  }
  // Match Shopify Admin’s main Orders view: current open orders only
  // (excludes old closed/archived orders).
  return "status:open";
}

async function fetchOrdersCount(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  query: string | null,
) {
  const response = await admin.graphql(
    `#graphql
    query marketplaceOrdersCount($query: String) {
      ordersCount(query: $query) {
        count
      }
    }`,
    { variables: { query } },
  );
  const json = await response.json();
  return Number(json.data?.ordersCount?.count ?? 0);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tab = (url.searchParams.get("tab") || "all").toLowerCase();
  const searchQuery = orderSearchQueryForTab(tab);

  let syncError: string | null = null;
  try {
    await syncRecentOrders(session.shop, admin, 25);
  } catch (error) {
    console.error("Auto order sync failed", error);
    syncError =
      error instanceof Error ? error.message : "Failed to sync recent orders.";
  }

  let orders: ShopifyOrderRow[] = [];
  let listError: string | null = null;
  let totalMatching = 0;
  try {
    const [list, count] = await Promise.all([
      fetchShopifyOrders(admin, { query: searchQuery || undefined, first: 100 }),
      fetchOrdersCount(admin, searchQuery),
    ]);
    orders = list;
    totalMatching = count;
  } catch (error) {
    console.error("Failed to load Shopify orders", error);
    listError =
      error instanceof Error ? error.message : "Failed to load Shopify orders.";
  }

  const attributions = await listAttributionsForShop(session.shop).catch(
    () => [] as Awaited<ReturnType<typeof listAttributionsForShop>>,
  );

  const sellersByOrder: Record<
    string,
    Array<{ name: string; subtotal: number; commission: number; currency: string }>
  > = {};
  for (const row of attributions) {
    if (!row.vendor?.name) continue;
    const list = sellersByOrder[row.shopifyOrderId] ?? [];
    list.push({
      name: row.vendor.name,
      subtotal: row.subtotal,
      commission: row.commissionAmount,
      currency: row.currency,
    });
    sellersByOrder[row.shopifyOrderId] = list;
  }

  const shopifyOrdersUrl =
    tab === "unfulfilled"
      ? shopifyAdminPath("orders?fulfillment_status=unfulfilled")
      : tab === "cancelled"
        ? shopifyAdminPath("orders?status=cancelled")
        : shopifyAdminPath("orders?status=open");

  return {
    orders,
    sellersByOrder,
    syncError: syncError || listError,
    shopifyOrdersUrl,
    totalMatching,
    listCap: 100,
  };
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
  const {
    orders,
    sellersByOrder,
    syncError,
    shopifyOrdersUrl,
    totalMatching,
    listCap,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tab = (searchParams.get("tab") || "all").toLowerCase();

  // Server already filters by tab (Admin-matching query). Client only searches.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qBare = q.replace(/^#/, "");
    if (!q) return orders;
    return orders.filter((order) => {
      const sellers = (sellersByOrder[order.id] || [])
        .map((s) => s.name)
        .join(" ")
        .toLowerCase();
      const hay = `${order.searchText || ""} ${sellers}`;
      return hay.includes(q) || (qBare.length > 0 && hay.includes(qBare));
    });
  }, [orders, query, sellersByOrder]);

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  }

  const truncated = !query && totalMatching > orders.length;

  return (
    <s-page heading="Orders">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-orders">
        <div className="nx-orders__head">
          <h1 className="nx-orders__title">Orders</h1>
          <div className="nx-orders__actions">
            <a
              className="nx-link-btn"
              href={shopifyOrdersUrl}
              target="_top"
            >
              Open in Shopify Admin
            </a>
          </div>
        </div>

        {syncError && <div className="nx-banner err">{syncError}</div>}
        {actionData && "error" in actionData && actionData.error && (
          <div className="nx-banner err">{actionData.error}</div>
        )}
        {actionData && "message" in actionData && actionData.message && (
          <div className="nx-banner ok">{actionData.message}</div>
        )}
        {!syncError && truncated && (
          <div className="nx-banner ok">
            Showing {orders.length} of {totalMatching} matching orders (latest{" "}
            {listCap}). Open Shopify Admin for the full list.
          </div>
        )}

        <div className="nx-tabs">
          {[
            { id: "all", label: "Open" },
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
              {tab === t.id && totalMatching > 0 ? ` (${totalMatching})` : ""}
            </button>
          ))}
        </div>

        <div className="nx-search-row">
          <div className="nx-search">
            <span aria-hidden>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search order #, customer, email, phone, product, or seller"
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
              {orders.length === 0
                ? "No orders found. Place a checkout on the store, then click Sync."
                : query.trim()
                  ? `No orders match “${query.trim()}”. Clear search to see all ${orders.length} order(s).`
                  : "No orders in this tab."}
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
                  const open = expandedId === order.id;
                  const adminOrderUrl = shopifyOrderAdminUrl(order.id);
                  return (
                    <tr key={order.id}>
                      <td>
                        <a
                          className="nx-order-link"
                          href={adminOrderUrl}
                          target="_top"
                        >
                          {order.name}
                        </a>
                        <p className="nx-secondary">
                          Created on {formatCreatedOn(order.createdAt)}
                        </p>
                        {sellers.length > 0 && (
                          <button
                            type="button"
                            className="nx-sellers"
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                            onClick={() =>
                              setExpandedId(open ? null : order.id)
                            }
                          >
                            Seller{sellers.length > 1 ? "s" : ""}:{" "}
                            {sellers.map((s) => s.name).join(", ")}
                          </button>
                        )}
                        {open && sellers.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            {sellers.map((s) => (
                              <p className="nx-secondary" key={`${order.id}-${s.name}`}>
                                {s.name}: {formatMoney(s.subtotal, s.currency)}{" "}
                                (commission{" "}
                                {formatMoney(s.commission, s.currency)})
                              </p>
                            ))}
                          </div>
                        )}
                        {open && sellers.length === 0 && (
                          <p className="nx-secondary" style={{ marginTop: 8 }}>
                            No marketplace seller attribution yet. Click Sync.
                          </p>
                        )}
                      </td>
                      <td>
                        <p className="nx-primary">{order.customerName}</p>
                        {order.customerAddress ? (
                          <p
                            className="nx-secondary"
                            style={{ whiteSpace: "pre-line", maxWidth: 220 }}
                          >
                            {order.customerAddress}
                          </p>
                        ) : null}
                        <p className="nx-secondary">
                          {order.customerEmail || "—"}
                        </p>
                        {order.customerPhone ? (
                          <p className="nx-secondary">{order.customerPhone}</p>
                        ) : null}
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
