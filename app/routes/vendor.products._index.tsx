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
  deleteVendorProduct,
  ensureVendorMetafieldsForVendor,
  getProductDetail,
  listMarketplaceProducts,
} from "../services/products.server";
import { fromProductPathId, toProductPathId } from "../utils/product-id";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const { admin } = await unauthenticated.admin(vendor.shop);
  try {
    await ensureVendorMetafieldsForVendor(admin, vendor.id, vendor.name);
  } catch (error) {
    console.error("Failed to backfill vendor metafields", error);
  }

  const products = await listMarketplaceProducts(admin, {
    vendorId: vendor.id,
    first: 50,
  });

  return { products, vendor };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const form = await request.formData();
  if (String(form.get("intent") || "") !== "delete") {
    return { error: "Unknown action." };
  }

  const pathId = String(form.get("productId") || "");
  if (!pathId) return { error: "Missing product." };
  const productId = fromProductPathId(pathId);

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    const existing = await getProductDetail(admin, productId);
    if (!existing || existing.metafield?.value !== vendor.id) {
      return { error: "You can only delete your own products." };
    }

    await deleteVendorProduct(admin, productId);
    return {
      ok: true,
      message: `"${existing.title}" was deleted.`,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to delete product.",
    };
  }
};

function statusBadge(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "ACTIVE") return { label: "Active", tone: "ok" };
  if (s === "DRAFT") return { label: "Draft", tone: "warn" };
  if (s === "ARCHIVED") return { label: "Archived", tone: "bad" };
  return { label: status, tone: "ok" };
}

export default function VendorProducts() {
  const { products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const deletingId =
    busy && navigation.formData?.get("intent") === "delete"
      ? String(navigation.formData.get("productId") || "")
      : "";

  const rows = useMemo(() => {
    return (products as Array<{
      id: string;
      title: string;
      status: string;
      totalInventory?: number | null;
      featuredImage?: { url?: string } | null;
      variants?: { nodes?: Array<{ price?: string }> };
    }>)
      .map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        stock: p.totalInventory ?? 0,
        price: p.variants?.nodes?.[0]?.price
          ? `$${p.variants.nodes[0].price}`
          : "—",
        image: p.featuredImage?.url || null,
        pathId: toProductPathId(p.id),
      }))
      .filter((row) => {
        const s = row.status.toUpperCase();
        if (tab === "active" && s !== "ACTIVE") return false;
        if (tab === "draft" && s !== "DRAFT") return false;
        if (!query.trim()) return true;
        return row.title.toLowerCase().includes(query.trim().toLowerCase());
      });
  }, [products, tab, query]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <h1 className="sx-title">Products</h1>
          <p className="sx-sub">Add, edit, or remove your listings</p>
        </div>
        <Link className="sx-btn sx-btn--primary" to="/vendor/products/new">
          + Add a product
        </Link>
      </div>

      {actionData && "error" in actionData && actionData.error && (
        <div className="sx-banner err">{actionData.error}</div>
      )}
      {actionData && "message" in actionData && actionData.message && (
        <div className="sx-banner ok">{actionData.message}</div>
      )}

      <div className="sx-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px" }}>
          <div className="sx-tabs">
            {[
              { id: "all", label: "All" },
              { id: "active", label: "Active" },
              { id: "draft", label: "Draft" },
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
              placeholder="Search your products by title"
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="sx-empty">
            No products yet.{" "}
            <Link className="sx-link" to="/vendor/products/new">
              Add your first product
            </Link>
          </div>
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Stock</th>
                  <th>Price</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const badge = statusBadge(row.status);
                  return (
                    <tr key={row.id}>
                      <td>
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
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
                            <p className="sx-secondary">
                              Current inventory is {row.stock}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`sx-badge ${badge.tone}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td>{row.stock}</td>
                      <td>{row.price}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <Link
                            className="sx-btn"
                            to={`/vendor/products/${row.pathId}`}
                          >
                            Edit
                          </Link>
                          <Form
                            method="post"
                            onSubmit={(event) => {
                              if (
                                !confirm(
                                  `Delete "${row.title}"? This cannot be undone.`,
                                )
                              ) {
                                event.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="intent" value="delete" />
                            <input
                              type="hidden"
                              name="productId"
                              value={row.pathId}
                            />
                            <button
                              className="sx-btn sx-btn--danger"
                              type="submit"
                              disabled={busy && deletingId !== row.pathId}
                            >
                              {deletingId === row.pathId ? "Deleting…" : "Delete"}
                            </button>
                          </Form>
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
