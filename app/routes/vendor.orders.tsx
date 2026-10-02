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

const CARRIERS = [
  "",
  "J&T Express",
  "Ninja Van",
  "LBC",
  "Flash Express",
  "SPX",
  "Grab Express",
  "Lalamove",
  "Other",
];

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

const URL_IN_TEXT =
  /https?:\/\/[^\s<>"')\]]+/gi;

function isImageUrl(url: string) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i.test(path);
  } catch {
    return false;
  }
}

function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].map((m) => m[0]);
}

function NoteWithLinks({ note }: { note: string }) {
  const urls = extractUrls(note);
  const imageUrls = urls.filter(isImageUrl);
  const parts = note.split(URL_IN_TEXT);
  const matches = note.match(URL_IN_TEXT) || [];

  return (
    <div
      className="sx-secondary"
      style={{
        marginTop: 8,
        padding: "8px 10px",
        background: "#f6f6f7",
        borderRadius: 8,
        maxWidth: 420,
      }}
    >
      <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        <strong style={{ color: "#202223" }}>Notes: </strong>
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {matches[i] ? (
              <a
                href={matches[i]}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#2c6ecb", wordBreak: "break-all" }}
              >
                {matches[i]}
              </a>
            ) : null}
          </span>
        ))}
      </p>
      {imageUrls.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 10,
          }}
        >
          {imageUrls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              title="Open design image"
            >
              <img
                src={url}
                alt="Custom design"
                style={{
                  width: 96,
                  height: 96,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid #e4e5e7",
                  display: "block",
                  background: "#fff",
                }}
              />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
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
  if (String(form.get("intent") || "") !== "fulfill") {
    return { error: "Unknown action." };
  }

  const attributionId = String(form.get("attributionId") || "");
  const trackingNumber = String(form.get("trackingNumber") || "").trim();
  const trackingCompany = String(form.get("trackingCompany") || "").trim();
  const trackingUrl = String(form.get("trackingUrl") || "").trim();

  if (!attributionId) return { error: "Missing order." };

  if (trackingUrl) {
    try {
      const parsed = new URL(trackingUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { error: "Tracking URL must start with http:// or https://" };
      }
    } catch {
      return { error: "Enter a valid tracking page link." };
    }
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
      trackingUrl: trackingUrl || null,
      notifyCustomer: true,
    });
    return {
      ok: true,
      message: `Marked ${attribution.shopifyOrderName || "order"} as fulfilled.`,
      attributionId,
    };
  } catch (error) {
    console.error("Vendor fulfill failed", error);
    const message =
      error instanceof Error ? error.message : "Failed to mark as fulfilled.";
    const needsScopes = /access denied|fulfillmentOrders|not authorized|scope/i.test(
      message,
    );
    return {
      error: needsScopes
        ? "Access denied for fulfillment. Update Railway SCOPES (add fulfillment order scopes), redeploy, then open Multivendor in Shopify Admin and approve the new permissions."
        : message,
    };
  }
};

type ShipDraft = {
  trackingNumber: string;
  trackingCompany: string;
  trackingUrl: string;
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
  const [shipDraft, setShipDraft] = useState<Record<string, ShipDraft>>({});

  const filtered = useMemo(() => {
    return attributions.filter((order) => {
      const status = statuses[order.shopifyOrderId];
      let fulfillment = (status?.fulfillment || "").toUpperCase();
      if (
        actionData &&
        "ok" in actionData &&
        actionData.attributionId === order.id
      ) {
        fulfillment = "FULFILLED";
      }
      if (tab === "unfulfilled" && fulfillment === "FULFILLED") return false;
      if (tab === "fulfilled" && fulfillment !== "FULFILLED") return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      const name = (order.shopifyOrderName || order.shopifyOrderId).toLowerCase();
      return name.includes(q);
    });
  }, [attributions, statuses, tab, query, actionData]);

  function draftFor(id: string): ShipDraft {
    return (
      shipDraft[id] || {
        trackingNumber: "",
        trackingCompany: "",
        trackingUrl: "",
      }
    );
  }

  return (
    <div>
      <h1 className="sx-title">Orders</h1>
      <p className="sx-sub">
        View orders, add tracking, mark fulfilled, and print invoices.
      </p>

      {actionData && "error" in actionData && actionData.error ? (
        <div
          className="sx-banner"
          style={{ background: "#fbeae9", color: "#8e1f0b" }}
        >
          {actionData.error}
        </div>
      ) : null}
      {actionData && "message" in actionData && actionData.message ? (
        <div
          className="sx-banner"
          style={{ background: "#e4f7e9", color: "#0d6b2d" }}
        >
          {actionData.message}
        </div>
      ) : null}

      <div className="sx-banner info">
        Enter <strong>tracking number</strong> and <strong>carrier</strong>, then
        tap <strong>Mark as fulfilled</strong>. Shopify notifies the customer.
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
                  const draft = draftFor(order.id);
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
                              <NoteWithLinks note={status.note} />
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
                            minWidth: 220,
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
                              <label
                                style={{
                                  display: "block",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  marginBottom: 4,
                                  color: "#6d7175",
                                }}
                              >
                                Tracking number
                              </label>
                              <input
                                type="text"
                                name="trackingNumber"
                                placeholder="e.g. 1234567890"
                                value={draft.trackingNumber}
                                onChange={(e) =>
                                  setShipDraft((prev) => ({
                                    ...prev,
                                    [order.id]: {
                                      ...draftFor(order.id),
                                      trackingNumber: e.target.value,
                                    },
                                  }))
                                }
                                style={{
                                  width: "100%",
                                  marginBottom: 8,
                                  padding: "8px 10px",
                                  borderRadius: 8,
                                  border: "1px solid #c9cccf",
                                  fontSize: 13,
                                  boxSizing: "border-box",
                                }}
                              />
                              <label
                                style={{
                                  display: "block",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  marginBottom: 4,
                                  color: "#6d7175",
                                }}
                              >
                                Shipping carrier
                              </label>
                              <select
                                name="trackingCompany"
                                value={draft.trackingCompany}
                                onChange={(e) =>
                                  setShipDraft((prev) => ({
                                    ...prev,
                                    [order.id]: {
                                      ...draftFor(order.id),
                                      trackingCompany: e.target.value,
                                    },
                                  }))
                                }
                                style={{
                                  width: "100%",
                                  marginBottom: 8,
                                  padding: "8px 10px",
                                  borderRadius: 8,
                                  border: "1px solid #c9cccf",
                                  fontSize: 13,
                                  boxSizing: "border-box",
                                  background: "#fff",
                                }}
                              >
                                <option value="">Select carrier</option>
                                {CARRIERS.filter(Boolean).map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <label
                                style={{
                                  display: "block",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  marginBottom: 4,
                                  color: "#6d7175",
                                }}
                              >
                                Tracking URL
                              </label>
                              <input
                                type="url"
                                name="trackingUrl"
                                placeholder="Enter valid tracking page link"
                                value={draft.trackingUrl}
                                onChange={(e) =>
                                  setShipDraft((prev) => ({
                                    ...prev,
                                    [order.id]: {
                                      ...draftFor(order.id),
                                      trackingUrl: e.target.value,
                                    },
                                  }))
                                }
                                style={{
                                  width: "100%",
                                  marginBottom: 8,
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
