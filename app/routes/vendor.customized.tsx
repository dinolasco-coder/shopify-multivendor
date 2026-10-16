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
import { unauthenticated } from "../shopify.server";
import { findImageUrls } from "../utils/note-links";
import {
  getProductDetail,
  listMarketplaceProducts,
  updateVendorProduct,
} from "../services/products.server";
import { fromProductPathId, toProductPathId } from "../utils/product-id";
import { formatMoney } from "../utils/money";
import {
  listCustomizationRequestsForVendor,
  updateCustomizationRequest,
  upsertCustomizationRequest,
} from "../models/customization.server";

type CustomDesign = {
  id: string;
  attributionId: string;
  orderName: string;
  orderId: string;
  createdAt: string;
  productTitle: string;
  note: string;
  imageUrls: string[];
  status: string;
  sellerNotes: string;
};

type AiProduct = {
  id: string;
  pathId: string;
  title: string;
  status: string;
  image: string | null;
  fee: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const attributions = await listAttributionsForVendor(vendor.id);
  let aiProducts: AiProduct[] = [];

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);

    const products = await listMarketplaceProducts(admin, {
      vendorId: vendor.id,
      first: 100,
    });

    aiProducts = (
      products as Array<{
        id: string;
        title: string;
        status: string;
        featuredImage?: { url?: string } | null;
        aiCustomizationFee?: { value?: string } | null;
      }>
    ).map((p) => ({
      id: p.id,
      pathId: toProductPathId(p.id),
      title: p.title,
      status: p.status,
      image: p.featuredImage?.url || null,
      fee: p.aiCustomizationFee?.value
        ? String(p.aiCustomizationFee.value)
        : null,
    }));

    await Promise.all(
      attributions.slice(0, 40).map(async (attr) => {
        try {
          const response = await admin.graphql(
            `#graphql
            query vendorCustomNote($id: ID!) {
              order(id: $id) {
                id
                name
                note
              }
            }`,
            { variables: { id: attr.shopifyOrderId } },
          );
          const json = await response.json();
          const order = json.data?.order;
          const note = order?.note ? String(order.note) : "";
          const imageUrls = findImageUrls(note);
          if (!imageUrls.length) return;

          let productTitle = "Product";
          try {
            const items = JSON.parse(attr.lineItemsJson || "[]") as Array<{
              title?: string;
            }>;
            productTitle = items[0]?.title || productTitle;
          } catch {
            /* ignore */
          }

          const orderName =
            attr.shopifyOrderName || order?.name || attr.shopifyOrderId;

          await upsertCustomizationRequest({
            shop: vendor.shop,
            vendorId: vendor.id,
            attributionId: attr.id,
            shopifyOrderId: attr.shopifyOrderId,
            orderName,
            productTitle,
            customerNote: note,
            imageUrls,
          });

          try {
            const { notifyCustomization } = await import(
              "../models/notifications.server"
            );
            await notifyCustomization({
              shop: vendor.shop,
              vendorId: vendor.id,
              orderName,
              attributionId: attr.id,
            });
          } catch (notifyError) {
            console.error("notify customization failed", notifyError);
          }
        } catch (error) {
          console.error("customized note fetch failed", attr.id, error);
        }
      }),
    );
  } catch (error) {
    console.error("Failed loading AI customization page", error);
  }

  const stored = await listCustomizationRequestsForVendor(vendor.id);
  const designs: CustomDesign[] = stored.map((row) => {
    let imageUrls: string[] = [];
    try {
      imageUrls = JSON.parse(row.imageUrlsJson || "[]") as string[];
    } catch {
      imageUrls = [];
    }
    return {
      id: row.id,
      attributionId: row.attributionId,
      orderName: row.orderName || row.shopifyOrderId,
      orderId: row.shopifyOrderId,
      createdAt: row.createdAt.toISOString(),
      productTitle: row.productTitle || "Product",
      note: row.customerNote || "",
      imageUrls,
      status: row.status,
      sellerNotes: row.sellerNotes || "",
    };
  });

  return {
    designs,
    aiProducts,
    withFeeCount: aiProducts.filter((p) => p.fee && Number(p.fee) > 0).length,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (
    intent === "acceptRequest" ||
    intent === "cancelRequest" ||
    intent === "updateRequest"
  ) {
    const requestId = String(form.get("requestId") || "");
    if (!requestId) return { error: "Missing customization request." };

    if (intent === "acceptRequest") {
      const updated = await updateCustomizationRequest(requestId, vendor.id, {
        status: "accepted",
      });
      if (!updated) return { error: "Request not found." };
      return {
        ok: true,
        message: `Accepted customization for ${updated.orderName || "order"}.`,
      };
    }

    if (intent === "cancelRequest") {
      const updated = await updateCustomizationRequest(requestId, vendor.id, {
        status: "cancelled",
      });
      if (!updated) return { error: "Request not found." };
      return {
        ok: true,
        message: `Cancelled customization for ${updated.orderName || "order"}.`,
      };
    }

    const sellerNotes = String(form.get("sellerNotes") || "");
    const updated = await updateCustomizationRequest(requestId, vendor.id, {
      sellerNotes,
    });
    if (!updated) return { error: "Request not found." };
    return {
      ok: true,
      message: `Updated notes for ${updated.orderName || "order"}.`,
    };
  }

  if (intent !== "saveFee") {
    return { error: "Unknown action." };
  }

  const pathId = String(form.get("productId") || "");
  const aiFeeRaw = String(form.get("aiCustomizationFee") || "").trim();
  if (!pathId) return { error: "Missing product." };

  const feeNum = aiFeeRaw === "" ? 0 : Number(aiFeeRaw);
  if (Number.isNaN(feeNum) || feeNum < 0) {
    return { error: "AI fee must be 0 or greater." };
  }
  const aiCustomizationFee = String(feeNum);

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    const productId = fromProductPathId(pathId);
    const existing = await getProductDetail(admin, productId);
    if (!existing || existing.metafield?.value !== vendor.id) {
      return { error: "You can only update your own products." };
    }

    const variant = existing.variants?.nodes?.[0];
    await updateVendorProduct(admin, {
      productId,
      vendorId: vendor.id,
      title: existing.title,
      descriptionHtml: existing.descriptionHtml || "",
      price: variant?.price,
      status: existing.status as "ACTIVE" | "DRAFT" | "ARCHIVED",
      variantId: variant?.id,
      aiCustomizationFee,
    });

    return {
      ok: true,
      message: `Updated AI fee for "${existing.title}".`,
      productId: pathId,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to update AI fee.",
    };
  }
};

function statusTone(status: string) {
  if (status === "accepted") return "ok";
  if (status === "cancelled") return "bad";
  return "warn";
}

function statusLabel(status: string) {
  if (status === "accepted") return "Accepted";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

export default function VendorAiCustomization() {
  const { designs, aiProducts, withFeeCount } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [tab, setTab] = useState<"requests" | "fees">("requests");
  const [query, setQuery] = useState("");

  const savingId =
    busy && navigation.formData?.get("intent") === "saveFee"
      ? String(navigation.formData.get("productId") || "")
      : "";

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return aiProducts;
    return aiProducts.filter((p) => p.title.toLowerCase().includes(q));
  }, [aiProducts, query]);

  return (
    <div>
      <div className="sx-page-head">
        <div>
          <h1 className="sx-title">AI customization</h1>
          <p className="sx-sub">
            Manage AI fees on your products and view customer design requests
          </p>
        </div>
        <Link className="sx-btn sx-btn--primary" to="/vendor/products/new">
          + Add product
        </Link>
      </div>

      {actionData && "error" in actionData && actionData.error && (
        <div className="sx-banner err">{actionData.error}</div>
      )}
      {actionData && "message" in actionData && actionData.message && (
        <div className="sx-banner ok">{actionData.message}</div>
      )}

      <div className="sx-metrics">
        <div className="sx-metric">
          <p className="sx-metric__label">Design requests</p>
          <p className="sx-metric__value">{designs.length}</p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Products with AI fee</p>
          <p className="sx-metric__value">{withFeeCount}</p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Your products</p>
          <p className="sx-metric__value">{aiProducts.length}</p>
        </div>
      </div>

      <div className="sx-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px" }}>
          <div className="sx-tabs">
            <button
              type="button"
              className={`sx-tab${tab === "requests" ? " is-active" : ""}`}
              onClick={() => setTab("requests")}
            >
              Design requests
            </button>
            <button
              type="button"
              className={`sx-tab${tab === "fees" ? " is-active" : ""}`}
              onClick={() => setTab("fees")}
            >
              AI fees on products
            </button>
          </div>
        </div>

        {tab === "requests" ? (
          designs.length === 0 ? (
            <div className="sx-empty">
              No custom design images yet. When a customer order has a design
              link in the notes, it shows up here.
            </div>
          ) : (
            <div style={{ padding: "0 16px 16px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 16,
                }}
              >
                {designs.map((d) => (
                  <div
                    key={d.id}
                    className="sx-panel"
                    style={{ marginBottom: 0, padding: 14 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        alignItems: "flex-start",
                        marginBottom: 4,
                      }}
                    >
                      <p className="sx-primary" style={{ margin: 0 }}>
                        {d.orderName}
                      </p>
                      <span className={`sx-stock sx-stock--${statusTone(d.status)}`}>
                        {statusLabel(d.status)}
                      </span>
                    </div>
                    <p className="sx-secondary" style={{ margin: "0 0 10px" }}>
                      {d.productTitle} ·{" "}
                      {new Date(d.createdAt).toLocaleDateString()}
                    </p>
                    {d.note ? (
                      <p
                        className="sx-secondary"
                        style={{ margin: "0 0 10px", whiteSpace: "pre-wrap" }}
                      >
                        {d.note.slice(0, 180)}
                        {d.note.length > 180 ? "…" : ""}
                      </p>
                    ) : null}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {d.imageUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "block",
                            textDecoration: "none",
                            color: "inherit",
                          }}
                        >
                          <img
                            src={url}
                            alt={`Custom design for ${d.orderName}`}
                            style={{
                              width: "100%",
                              aspectRatio: "1",
                              objectFit: "cover",
                              borderRadius: 10,
                              border: "1px solid #e4e5e7",
                              background: "#fff",
                              display: "block",
                            }}
                          />
                          <span
                            style={{
                              display: "inline-block",
                              marginTop: 8,
                              color: "#2c6ecb",
                              fontWeight: 700,
                              fontSize: 13,
                              textDecoration: "underline",
                            }}
                          >
                            Open design
                          </span>
                        </a>
                      ))}
                    </div>

                    <Form method="post" style={{ marginTop: 12 }}>
                      <input type="hidden" name="requestId" value={d.id} />
                      <input type="hidden" name="intent" value="updateRequest" />
                      <label
                        style={{
                          display: "block",
                          fontSize: 12,
                          fontWeight: 600,
                          marginBottom: 4,
                        }}
                      >
                        Seller notes
                      </label>
                      <textarea
                        name="sellerNotes"
                        defaultValue={d.sellerNotes}
                        rows={2}
                        placeholder="Update details / notes for this request"
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          border: "1px solid #c9cccf",
                          borderRadius: 8,
                          padding: "8px 10px",
                          fontSize: 13,
                          resize: "vertical",
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        <button
                          className="sx-btn"
                          type="submit"
                          disabled={busy || d.status === "cancelled"}
                        >
                          Save updates
                        </button>
                      </div>
                    </Form>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        marginTop: 10,
                      }}
                    >
                      {d.status === "pending" ? (
                        <>
                          <Form method="post">
                            <input type="hidden" name="requestId" value={d.id} />
                            <input
                              type="hidden"
                              name="intent"
                              value="acceptRequest"
                            />
                            <button
                              className="sx-btn sx-btn--primary"
                              type="submit"
                              disabled={busy}
                            >
                              Accept
                            </button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="requestId" value={d.id} />
                            <input
                              type="hidden"
                              name="intent"
                              value="cancelRequest"
                            />
                            <button
                              className="sx-btn"
                              type="submit"
                              disabled={busy}
                              onClick={(e) => {
                                if (
                                  !window.confirm(
                                    `Cancel customization for ${d.orderName}?`,
                                  )
                                ) {
                                  e.preventDefault();
                                }
                              }}
                            >
                              Cancel
                            </button>
                          </Form>
                        </>
                      ) : null}
                      {d.status === "accepted" ? (
                        <Form method="post">
                          <input type="hidden" name="requestId" value={d.id} />
                          <input
                            type="hidden"
                            name="intent"
                            value="cancelRequest"
                          />
                          <button
                            className="sx-btn"
                            type="submit"
                            disabled={busy}
                            onClick={(e) => {
                              if (
                                !window.confirm(
                                  `Cancel customization for ${d.orderName}?`,
                                )
                              ) {
                                e.preventDefault();
                              }
                            }}
                          >
                            Cancel request
                          </button>
                        </Form>
                      ) : null}
                      <Link
                        className="sx-btn"
                        to="/vendor/orders"
                        style={{ fontSize: 13 }}
                      >
                        View in Orders
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          <>
            <div style={{ padding: "0 16px 14px" }}>
              <div className="sx-search">
                <span aria-hidden>⌕</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products"
                />
              </div>
              <p className="sx-secondary" style={{ margin: "0 0 4px" }}>
                Set an extra AI customization fee per product. Leave blank or 0
                for none.
              </p>
            </div>
            {filteredProducts.length === 0 ? (
              <div className="sx-empty">
                No products yet.{" "}
                <Link className="sx-link" to="/vendor/products/new">
                  Add a product
                </Link>{" "}
                and optionally set an AI fee.
              </div>
            ) : (
              <div className="sx-table-wrap">
                <table className="sx-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Status</th>
                      <th>AI fee</th>
                      <th>Update fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p) => {
                      const feeNum = p.fee ? Number(p.fee) : 0;
                      const hasFee = Number.isFinite(feeNum) && feeNum > 0;
                      return (
                        <tr key={p.id}>
                          <td>
                            <div
                              style={{
                                display: "flex",
                                gap: 12,
                                alignItems: "center",
                              }}
                            >
                              {p.image ? (
                                <img
                                  src={p.image}
                                  alt=""
                                  style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: 8,
                                    objectFit: "cover",
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: 8,
                                    background: "#f1f2f3",
                                  }}
                                />
                              )}
                              <div>
                                <p className="sx-primary">{p.title}</p>
                                <Link
                                  className="sx-link"
                                  to={`/vendor/products/${p.pathId}`}
                                >
                                  Edit product
                                </Link>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span
                              className={`sx-badge ${
                                p.status.toUpperCase() === "ACTIVE"
                                  ? "ok"
                                  : "warn"
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td>
                            {hasFee ? (
                              <span className="sx-stock sx-stock--ok">
                                {formatMoney(feeNum, "PHP")}
                              </span>
                            ) : (
                              <span className="sx-secondary">None</span>
                            )}
                          </td>
                          <td>
                            <Form method="post" className="sx-stock-form">
                              <input
                                type="hidden"
                                name="intent"
                                value="saveFee"
                              />
                              <input
                                type="hidden"
                                name="productId"
                                value={p.pathId}
                              />
                              <input
                                className="sx-stock-input"
                                name="aiCustomizationFee"
                                type="number"
                                min={0}
                                step={0.01}
                                defaultValue={p.fee || ""}
                                placeholder="0"
                                aria-label={`AI fee for ${p.title}`}
                                key={`${p.pathId}-${p.fee ?? "none"}-${
                                  actionData &&
                                  "productId" in actionData &&
                                  actionData.productId === p.pathId
                                    ? "saved"
                                    : "base"
                                }`}
                              />
                              <button
                                className="sx-btn sx-btn--primary"
                                type="submit"
                                disabled={busy && savingId === p.pathId}
                              >
                                {savingId === p.pathId ? "Saving…" : "Save"}
                              </button>
                            </Form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
