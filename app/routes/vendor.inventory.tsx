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
import { unauthenticated } from "../shopify.server";
import {
  getProductDetail,
  listMarketplaceProducts,
  updateVendorProductInventory,
} from "../services/products.server";
import { fromProductPathId, toProductPathId } from "../utils/product-id";

type ProductRow = {
  id: string;
  title: string;
  status: string;
  stock: number;
  image: string | null;
  pathId: string;
  inventoryItemId: string | null;
};

function mapProducts(products: unknown[]): ProductRow[] {
  return (
    products as Array<{
      id: string;
      title: string;
      status: string;
      totalInventory?: number | null;
      featuredImage?: { url?: string } | null;
      variants?: {
        nodes?: Array<{
          inventoryQuantity?: number | null;
          inventoryItem?: { id?: string } | null;
        }>;
      };
    }>
  ).map((p) => {
    const variant = p.variants?.nodes?.[0];
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      stock: variant?.inventoryQuantity ?? p.totalInventory ?? 0,
      image: p.featuredImage?.url || null,
      pathId: toProductPathId(p.id),
      inventoryItemId: variant?.inventoryItem?.id ?? null,
    };
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const { admin } = await unauthenticated.admin(vendor.shop);
  const products = await listMarketplaceProducts(admin, {
    vendorId: vendor.id,
    first: 100,
  });

  const rows = mapProducts(products);
  const lowStock = rows.filter((r) => r.stock <= 5).length;
  const outOfStock = rows.filter((r) => r.stock <= 0).length;

  return { rows, lowStock, outOfStock, total: rows.length };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const form = await request.formData();
  if (String(form.get("intent") || "") !== "updateStock") {
    return { error: "Unknown action." };
  }

  const pathId = String(form.get("productId") || "");
  const inventoryItemId = String(form.get("inventoryItemId") || "");
  const inventoryQuantity = Number(form.get("inventoryQuantity"));

  if (!pathId) return { error: "Missing product." };
  if (!inventoryItemId) {
    return {
      error:
        "This product has no inventory item. Open it in Shopify Admin and enable tracking.",
    };
  }
  if (!Number.isFinite(inventoryQuantity) || inventoryQuantity < 0) {
    return { error: "Quantity must be 0 or greater." };
  }

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    const productId = fromProductPathId(pathId);
    const existing = await getProductDetail(admin, productId);
    if (!existing || existing.metafield?.value !== vendor.id) {
      return { error: "You can only update your own products." };
    }

    const expectedItemId = existing.variants?.nodes?.[0]?.inventoryItem?.id;
    if (expectedItemId && expectedItemId !== inventoryItemId) {
      return { error: "Inventory item mismatch. Refresh and try again." };
    }

    await updateVendorProductInventory(admin, {
      inventoryItemId: expectedItemId || inventoryItemId,
      inventoryQuantity: Math.floor(inventoryQuantity),
    });

    return {
      ok: true,
      message: `Updated stock for "${existing.title}" to ${Math.floor(inventoryQuantity)}.`,
      productId: pathId,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to update inventory.",
    };
  }
};

export default function VendorInventory() {
  const { rows, lowStock, outOfStock, total } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [tab, setTab] = useState<"all" | "low" | "out">("all");
  const [query, setQuery] = useState("");

  const savingId =
    busy && navigation.formData?.get("intent") === "updateStock"
      ? String(navigation.formData.get("productId") || "")
      : "";

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab === "low" && !(row.stock > 0 && row.stock <= 5)) return false;
      if (tab === "out" && row.stock > 0) return false;
      if (!query.trim()) return true;
      return row.title.toLowerCase().includes(query.trim().toLowerCase());
    });
  }, [rows, tab, query]);

  return (
    <div>
      <div className="sx-page-head">
        <div>
          <h1 className="sx-title">Inventory</h1>
          <p className="sx-sub">
            Update stock for all your products in one place
          </p>
        </div>
        <Link className="sx-btn" to="/vendor/products">
          Back to products
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
          <p className="sx-metric__label">Products</p>
          <p className="sx-metric__value">{total}</p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Low stock (≤5)</p>
          <p className="sx-metric__value">{lowStock}</p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Out of stock</p>
          <p className="sx-metric__value">{outOfStock}</p>
        </div>
      </div>

      <div className="sx-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px" }}>
          <div className="sx-tabs">
            {(
              [
                { id: "all", label: "All" },
                { id: "low", label: "Low stock" },
                { id: "out", label: "Out of stock" },
              ] as const
            ).map((t) => (
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
              placeholder="Search products"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="sx-empty">
            {total === 0 ? (
              <>
                No products yet.{" "}
                <Link className="sx-link" to="/vendor/products/new">
                  Add your first product
                </Link>
              </>
            ) : (
              "No products match this filter."
            )}
          </div>
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Current stock</th>
                  <th>Update quantity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const tone =
                    row.stock <= 0 ? "bad" : row.stock <= 5 ? "warn" : "ok";
                  return (
                    <tr key={row.id}>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "center",
                          }}
                        >
                          {row.image ? (
                            <img
                              src={row.image}
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
                            <p className="sx-primary">{row.title}</p>
                            <Link
                              className="sx-link"
                              to={`/vendor/products/${row.pathId}`}
                            >
                              Edit product
                            </Link>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`sx-badge ${
                            row.status.toUpperCase() === "ACTIVE"
                              ? "ok"
                              : "warn"
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td>
                        <span className={`sx-stock sx-stock--${tone}`}>
                          {row.stock}
                        </span>
                      </td>
                      <td>
                        {row.inventoryItemId ? (
                          <Form method="post" className="sx-stock-form">
                            <input
                              type="hidden"
                              name="intent"
                              value="updateStock"
                            />
                            <input
                              type="hidden"
                              name="productId"
                              value={row.pathId}
                            />
                            <input
                              type="hidden"
                              name="inventoryItemId"
                              value={row.inventoryItemId}
                            />
                            <input
                              className="sx-stock-input"
                              name="inventoryQuantity"
                              type="number"
                              min={0}
                              step={1}
                              defaultValue={row.stock}
                              key={`${row.pathId}-${row.stock}-${
                                actionData &&
                                "productId" in actionData &&
                                actionData.productId === row.pathId
                                  ? "saved"
                                  : "base"
                              }`}
                              aria-label={`Quantity for ${row.title}`}
                            />
                            <button
                              className="sx-btn sx-btn--primary"
                              type="submit"
                              disabled={busy && savingId === row.pathId}
                            >
                              {savingId === row.pathId ? "Saving…" : "Save"}
                            </button>
                          </Form>
                        ) : (
                          <p className="sx-secondary">
                            Tracking not enabled in Shopify.
                          </p>
                        )}
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
