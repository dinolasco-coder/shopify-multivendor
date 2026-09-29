import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useMemo, useState } from "react";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { listAttributionsForVendor } from "../models/attribution.server";
import { formatMoney } from "../utils/money";
import { unauthenticated } from "../shopify.server";
import { fulfillVendorLineItems } from "../services/fulfillment.server";
import prisma from "../db.server";

type OrderStatusMap = Record<
  string,
  {
    fulfillment: string;
    financial: string;
    adminUrl: string;
    note: string | null;
    details: Array<{ key: string; value: string }>;
    imagesByLineId: Record<string, string>;
    imagesByTitle: Record<string, string>;
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
              note
              customAttributes { key value }
              displayFulfillmentStatus
              displayFinancialStatus
              lineItems(first: 50) {
                nodes {
                  id
                  title
                  image { url }
                  product {
                    featuredImage { url }
                  }
                  variant {
                    image { url }
                  }
                }
              }
            }
          }`,
          { variables: { id } },
        );
        const json = await response.json();
        const order = json.data?.order;
        if (!order) return;
        const numeric = String(order.id).split("/").pop();
        const imagesByLineId: Record<string, string> = {};
        const imagesByTitle: Record<string, string> = {};
        for (const li of order.lineItems?.nodes ?? []) {
          const url =
            li?.image?.url ||
            li?.variant?.image?.url ||
            li?.product?.featuredImage?.url ||
            null;
          if (!url) continue;
          if (li?.id) imagesByLineId[li.id] = url;
          if (li?.title) {
            imagesByTitle[String(li.title).toLowerCase()] = url;
          }
        }
        const details = (
          (order.customAttributes ?? []) as Array<{
            key?: string;
            value?: string;
          }>
        )
          .filter((a) => a.key && a.value)
          .map((a) => ({
            key: String(a.key),
            value: String(a.value),
          }));
        map[id] = {
          fulfillment: order.displayFulfillmentStatus || "UNFULFILLED",
          financial: order.displayFinancialStatus || "PENDING",
          adminUrl: `https://admin.shopify.com/store/${shopHandle}/orders/${numeric}`,
          note: order.note ? String(order.note) : null,
          details,
          imagesByLineId,
          imagesByTitle,
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

function parseLineItemIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed)
      ? parsed.map((id) => String(id)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (intent !== "fulfill") {
    return { error: "Unknown action." };
  }

  const attributionId = String(form.get("attributionId") || "");
  const trackingNumber = String(form.get("trackingNumber") || "").trim();
  const trackingCompany = String(form.get("trackingCompany") || "").trim();

  if (!attributionId) {
    return { error: "Missing order." };
  }

  const attribution = await prisma.orderAttribution.findUnique({
    where: { id: attributionId },
  });
  if (!attribution || attribution.vendorId !== vendor.id) {
    return { error: "You can only fulfill your own order items." };
  }

  const lineItemIds = parseLineItemIds(attribution.lineItemIds);
  if (!lineItemIds.length) {
    return { error: "No line items found for this order." };
  }

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    await fulfillVendorLineItems(admin, {
      shopifyOrderId: attribution.shopifyOrderId,
      lineItemIds,
      trackingNumber: trackingNumber || null,
      trackingCompany: trackingCompany || null,
      notifyCustomer: true,
    });
    return {
      ok: true,
      message: `Marked ${attribution.shopifyOrderName || "order"} as fulfilled.`,
      attributionId,
    };
  } catch (error) {
    console.error("Vendor fulfill failed", error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to mark as fulfilled. Reinstall/update the Multivendor app scopes in Shopify Admin if prompted.",
    };
  }
};

export default function VendorOrders() {
  const { attributions, statuses } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const fulfillingId =
    busy && navigation.formData?.get("intent") === "fulfill"
      ? String(navigation.formData.get("attributionId") || "")
      : "";

  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [trackingByOrder, setTrackingByOrder] = useState<
    Record<string, string>
  >({});

  const filtered = useMemo(() => {
    return attributions.filter((order) => {
      const status = statuses[order.shopifyOrderId];
      const fulfillment = (status?.fulfillment || "").toUpperCase();
      if (tab === "unfulfilled" && fulfillment === "FULFILLED") return false;
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
        View your orders, mark them fulfilled, and print invoices.
      </p>

      {actionData && "error" in actionData && actionData.error ? (
        <div className="sx-banner" style={{ background: "#fbeae9", color: "#8e1f0b" }}>
          {actionData.error}
        </div>
      ) : null}
      {actionData && "message" in actionData && actionData.message ? (
        <div className="sx-banner" style={{ background: "#e4f7e9", color: "#0d6b2d" }}>
          {actionData.message}
        </div>
      ) : null}

      <div className="sx-banner info">
        Use <strong>Mark as fulfilled</strong> when you ship your items. Add a
        tracking number if you have one. Customer gets notified by Shopify.
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
                    id?: string;
                    title: string;
                    quantity: number;
                    imageUrl?: string | null;
                  }>;
                  const status = statuses[order.shopifyOrderId];
                  const fulfillment = (
                    actionData &&
                    "ok" in actionData &&
                    actionData.attributionId === order.id
                      ? "FULFILLED"
                      : status?.fulfillment || "UNFULFILLED"
                  ).toUpperCase();
                  const financial = status?.financial || "PENDING";
                  const canFulfill =
                    fulfillment !== "FULFILLED" &&
                    fulfillment !== "CANCELLED";
                  const enrichedItems = items.map((item) => ({
                    ...item,
                    imageUrl:
                      item.imageUrl ||
                      (item.id ? status?.imagesByLineId?.[item.id] : null) ||
                      status?.imagesByTitle?.[
                        String(item.title || "").toLowerCase()
                      ] ||
                      null,
                  }));
                  return (
                    <tr key={order.id}>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "flex-start",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              flexShrink: 0,
                            }}
                          >
                            {enrichedItems.slice(0, 3).map((item, idx) =>
                              item.imageUrl ? (
                                <img
                                  key={idx}
                                  src={item.imageUrl}
                                  alt=""
                                  style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: 8,
                                    objectFit: "cover",
                                    border: "1px solid #e4e5e7",
                                  }}
                                />
                              ) : (
                                <div
                                  key={idx}
                                  style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: 8,
                                    background: "#f1f2f3",
                                    border: "1px solid #e4e5e7",
                                  }}
                                />
                              ),
                            )}
                          </div>
                          <div>
                            <p className="sx-primary">
                              {order.shopifyOrderName || order.shopifyOrderId}
                            </p>
                            <p className="sx-secondary">
                              {new Date(order.createdAt).toLocaleString()}
                            </p>
                            <p className="sx-secondary">
                              {enrichedItems
                                .map((i) => `${i.title} × ${i.quantity}`)
                                .join(" · ")}
                            </p>
                            {status?.note ? (
                              <p
                                className="sx-secondary"
                                style={{
                                  marginTop: 8,
                                  padding: "8px 10px",
                                  background: "#f6f6f7",
                                  borderRadius: 8,
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                  maxWidth: 420,
                                }}
                              >
                                <strong style={{ color: "#202223" }}>
                                  Notes:{" "}
                                </strong>
                                {status.note}
                              </p>
                            ) : null}
                            {status?.details?.length ? (
                              <div
                                style={{
                                  marginTop: 6,
                                  fontSize: 12,
                                  color: "#6d7175",
                                  maxWidth: 420,
                                }}
                              >
                                <strong style={{ color: "#202223" }}>
                                  Additional details
                                </strong>
                                <ul
                                  style={{
                                    margin: "4px 0 0",
                                    paddingLeft: 16,
                                  }}
                                >
                                  {status.details.map((d) => (
                                    <li key={d.key}>
                                      {d.key}: {d.value}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        </div>
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
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                            minWidth: 180,
                          }}
                        >
                          {canFulfill ? (
                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="fulfill"
                              />
                              <input
                                type="hidden"
                                name="attributionId"
                                value={order.id}
                              />
                              <input
                                type="text"
                                name="trackingNumber"
                                placeholder="Tracking # (optional)"
                                value={trackingByOrder[order.id] || ""}
                                onChange={(e) =>
                                  setTrackingByOrder((prev) => ({
                                    ...prev,
                                    [order.id]: e.target.value,
                                  }))
                                }
                                style={{
                                  width: "100%",
                                  marginBottom: 6,
                                  padding: "8px 10px",
                                  borderRadius: 8,
                                  border: "1px solid #c9cccf",
                                  fontSize: 13,
                                  boxSizing: "border-box",
                                }}
                              />
                              <button
                                type="submit"
                                className="sx-btn sx-btn--primary"
                                disabled={busy}
                                style={{ width: "100%" }}
                              >
                                {fulfillingId === order.id
                                  ? "Fulfilling…"
                                  : "Mark as fulfilled"}
                              </button>
                            </Form>
                          ) : null}
                          <div
                            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                          >
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
                              className="sx-btn"
                              to={`/vendor/invoice/${order.id}`}
                              target="_blank"
                            >
                              Invoice
                            </Link>
                          </div>
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
