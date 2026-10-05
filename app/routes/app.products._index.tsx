import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { useMemo, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getProductDetail,
  listMarketplaceProducts,
  updateVendorProduct,
} from "../services/products.server";
import { listVendors } from "../models/vendor.server";
import { getOrCreateSettings } from "../models/settings.server";
import { ADMIN_STORE_VENDOR_ID } from "../constants";

function shopAdminProductsUrl(shop: string) {
  const handle = shop.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${handle}/products`;
}

function shopAdminProductUrl(shop: string, productGid: string) {
  const numericId = productGid.split("/").pop() || "";
  return `${shopAdminProductsUrl(shop)}/${numericId}`;
}

function shopAdminNewProductUrl(shop: string) {
  return `${shopAdminProductsUrl(shop)}/new`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [products, vendors, settings] = await Promise.all([
    listMarketplaceProducts(admin, { first: 100 }),
    listVendors(session.shop),
    getOrCreateSettings(session.shop),
  ]);

  const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v]));

  return {
    products,
    vendorMap,
    requireProductApproval: settings.requireProductApproval,
    shopifyProductsUrl: shopAdminProductsUrl(session.shop),
    shopifyNewProductUrl: shopAdminNewProductUrl(session.shop),
    shop: session.shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const productId = String(form.get("productId") || "");

  if (!productId) return { error: "Missing product." };

  const product = await getProductDetail(admin, productId);
  if (!product?.metafield?.value) {
    return { error: "Not a marketplace product." };
  }

  const vendorId = product.metafield.value as string;

  try {
    if (intent === "approve") {
      await updateVendorProduct(admin, {
        productId,
        vendorId,
        title: product.title,
        descriptionHtml: product.descriptionHtml || "",
        status: "ACTIVE",
      });
      return { ok: true, message: `"${product.title}" approved.` };
    }
    if (intent === "reject") {
      await updateVendorProduct(admin, {
        productId,
        vendorId,
        title: product.title,
        descriptionHtml: product.descriptionHtml || "",
        status: "ARCHIVED",
      });
      return { ok: true, message: `"${product.title}" rejected (archived).` };
    }
    return { error: "Unknown action." };
  } catch (error) {
    console.error("Product status update failed", session.shop, error);
    return {
      error:
        error instanceof Error ? error.message : "Failed to update product.",
    };
  }
};

const styles = `
  .nx-products { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-products__head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 18px; flex-wrap: wrap; }
  .nx-products__title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .nx-products__actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .nx-btn {
    border: 1px solid #c9cccf; background: #fff; color: #202223; border-radius: 8px;
    padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
  }
  .nx-btn--primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  .nx-btn--danger { color: #8e1f0b; border-color: #e0b3b0; }
  .nx-btn:disabled { opacity: 0.6; cursor: default; }
  .nx-panel { background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; overflow: hidden; }
  .nx-panel__inner { padding: 14px 16px; }
  .nx-tabs { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .nx-tab {
    border: none; background: transparent; padding: 8px 14px; border-radius: 8px;
    font-size: 13px; font-weight: 600; color: #6d7175; cursor: pointer;
  }
  .nx-tab.is-active { background: #e4e5e7; color: #1a1a1a; }
  .nx-search {
    display: flex; align-items: center; gap: 8px; border: 1px solid #c9cccf;
    border-radius: 10px; background: #fff; padding: 10px 12px;
  }
  .nx-search input { border: none; outline: none; width: 100%; font-size: 14px; background: transparent; }
  .nx-table { width: 100%; border-collapse: collapse; }
  .nx-table th {
    text-align: left; font-size: 12px; font-weight: 600; color: #6d7175;
    padding: 12px 16px; border-bottom: 1px solid #e4e5e7; background: #fafbfb;
  }
  .nx-table td { padding: 14px 16px; border-bottom: 1px solid #ececec; vertical-align: middle; font-size: 13px; }
  .nx-table tr:last-child td { border-bottom: none; }
  .nx-product { display: flex; gap: 12px; align-items: center; }
  .nx-thumb {
    width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: #f1f2f3; flex-shrink: 0;
  }
  .nx-thumb--empty {
    display: flex; align-items: center; justify-content: center; color: #8c9196; font-size: 11px;
  }
  .nx-primary { font-weight: 700; margin: 0 0 2px; }
  .nx-product-link {
    font-weight: 700; color: #1a1a1a; text-decoration: none;
  }
  .nx-product-link:hover { text-decoration: underline; }
  .nx-secondary { margin: 0; color: #6d7175; font-size: 12px; }
  .nx-badge {
    display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; white-space: nowrap;
  }
  .nx-badge.ok { background: #e4f7e9; color: #0d6b2d; }
  .nx-badge.warn { background: #fff4d6; color: #8a6d00; }
  .nx-badge.bad { background: #fbeae9; color: #8e1f0b; }
  .nx-badge.neutral { background: #f1f2f3; color: #5c5f62; }
  .nx-empty { padding: 28px 16px; text-align: center; color: #6d7175; }
  .nx-banner { margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
  .nx-banner.err { background: #fbeae9; color: #8e1f0b; }
  .nx-banner.okmsg { background: #e4f7e9; color: #0d6b2d; }
  .nx-row-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  @media (max-width: 900px) {
    .nx-table { min-width: 760px; }
    .nx-panel { overflow-x: auto; }
  }
`;

function statusBadge(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "ACTIVE") return { label: "Active", tone: "ok" };
  if (s === "DRAFT") return { label: "Draft", tone: "neutral" };
  if (s === "ARCHIVED") return { label: "Archived", tone: "bad" };
  return { label: status, tone: "neutral" };
}

function approvalBadge(status: string, requireApproval: boolean) {
  const s = String(status || "").toUpperCase();
  if (s === "ACTIVE") return { label: "Approved", tone: "ok" };
  if (s === "ARCHIVED") return { label: "Rejected", tone: "bad" };
  if (s === "DRAFT") {
    return requireApproval
      ? { label: "Pending", tone: "warn" }
      : { label: "Draft", tone: "neutral" };
  }
  return { label: "—", tone: "neutral" };
}

export default function AdminProductsPage() {
  const {
    products,
    vendorMap,
    requireProductApproval,
    shopifyProductsUrl,
    shopifyNewProductUrl,
    shop,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tab = (searchParams.get("tab") || "all").toLowerCase();

  // Show all Shopify products (same source as Admin), not only marketplace-tagged ones.
  const allProducts = useMemo(
    () =>
      products as Array<{
        id: string;
        title: string;
        status: string;
        handle?: string;
        vendor?: string | null;
        featuredImage?: { url?: string; altText?: string | null } | null;
        totalInventory?: number | null;
        variants?: { nodes?: unknown[] };
        metafield?: { value?: string } | null;
      }>,
    [products],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allProducts.filter((product) => {
      const status = String(product.status || "").toUpperCase();
      if (tab === "active" && status !== "ACTIVE") return false;
      if (tab === "rejected" && status !== "ARCHIVED") return false;
      if (tab === "draft" && status !== "DRAFT") return false;
      if (tab === "pending") {
        if (!(status === "DRAFT" && requireProductApproval)) return false;
      }
      if (!q) return true;
      const vendorId = product.metafield?.value || "";
      const seller =
        vendorId === ADMIN_STORE_VENDOR_ID
          ? "store admin"
          : vendorMap[vendorId]?.name || product.vendor || "";
      return (
        product.title.toLowerCase().includes(q) ||
        product.id.toLowerCase().includes(q) ||
        (product.handle || "").toLowerCase().includes(q) ||
        (product.vendor || "").toLowerCase().includes(q) ||
        seller.toLowerCase().includes(q)
      );
    });
  }, [allProducts, query, tab, vendorMap, requireProductApproval]);

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <s-page heading="Products">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-products">
        <div className="nx-products__head">
          <h1 className="nx-products__title">Products</h1>
          <div className="nx-products__actions">
            <a
              className="nx-btn"
              href={shopifyProductsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in Shopify Admin
            </a>
            <a
              className="nx-btn"
              href={shopifyNewProductUrl}
              target="_blank"
              rel="noreferrer"
            >
              Add in Shopify
            </a>
            <Link className="nx-btn nx-btn--primary" to="/app/products/new">
              + Add a new product
            </Link>
          </div>
        </div>

        {actionData && "error" in actionData && actionData.error && (
          <div className="nx-banner err">{actionData.error}</div>
        )}
        {actionData && "message" in actionData && actionData.message && (
          <div className="nx-banner okmsg">{actionData.message}</div>
        )}

        <div className="nx-panel">
          <div className="nx-panel__inner">
            <div className="nx-tabs">
              {[
                { id: "all", label: "All" },
                { id: "active", label: "Active" },
                { id: "rejected", label: "Archived" },
                { id: "draft", label: "Draft" },
                { id: "pending", label: "Pending approval" },
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
            <div className="nx-search">
              <span aria-hidden>⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products by title, id, or vendor"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="nx-empty">
              <p style={{ margin: "0 0 14px" }}>
                {allProducts.length === 0
                  ? "No products found in Shopify yet."
                  : "No products match this filter."}
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                <a
                  className="nx-btn"
                  href={shopifyProductsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Shopify Admin
                </a>
                <Link className="nx-btn nx-btn--primary" to="/app/products/new">
                  + Add a new product
                </Link>
              </div>
            </div>
          ) : (
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Inventory</th>
                  <th>Vendor</th>
                  <th>Approval</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => {
                  const vendorId = product.metafield?.value || "";
                  const vendorLabel =
                    vendorId === ADMIN_STORE_VENDOR_ID
                      ? "Store (admin)"
                      : vendorMap[vendorId]?.name ||
                        product.vendor ||
                        "—";
                  const status = statusBadge(product.status);
                  const approval = vendorId
                    ? approvalBadge(product.status, requireProductApproval)
                    : { label: "—", tone: "neutral" };
                  const inventory = product.totalInventory ?? 0;
                  const variantCount =
                    (product as { variantsCount?: { count?: number } })
                      .variantsCount?.count ??
                    product.variants?.nodes?.length ??
                    1;
                  const open = expandedId === product.id;
                  const isDraft =
                    String(product.status || "").toUpperCase() === "DRAFT";
                  const isMarketplace = Boolean(vendorId);
                  const adminUrl = shopAdminProductUrl(shop, product.id);

                  return (
                    <tr key={product.id}>
                      <td>
                        <div className="nx-product">
                          {product.featuredImage?.url ? (
                            <img
                              className="nx-thumb"
                              src={product.featuredImage.url}
                              alt={
                                product.featuredImage.altText || product.title
                              }
                            />
                          ) : (
                            <div className="nx-thumb nx-thumb--empty">
                              No img
                            </div>
                          )}
                          <div>
                            <a
                              className="nx-product-link"
                              href={adminUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {product.title}
                            </a>
                            <p className="nx-secondary">
                              {inventory.toLocaleString()} in stock for{" "}
                              {variantCount} variant
                              {variantCount === 1 ? "" : "s"}
                            </p>
                            {open && isMarketplace && isDraft && (
                              <div className="nx-row-actions">
                                <Form method="post">
                                  <input
                                    type="hidden"
                                    name="intent"
                                    value="approve"
                                  />
                                  <input
                                    type="hidden"
                                    name="productId"
                                    value={product.id}
                                  />
                                  <button
                                    className="nx-btn nx-btn--primary"
                                    type="submit"
                                    disabled={busy}
                                  >
                                    Approve
                                  </button>
                                </Form>
                                <Form method="post">
                                  <input
                                    type="hidden"
                                    name="intent"
                                    value="reject"
                                  />
                                  <input
                                    type="hidden"
                                    name="productId"
                                    value={product.id}
                                  />
                                  <button
                                    className="nx-btn nx-btn--danger"
                                    type="submit"
                                    disabled={busy}
                                  >
                                    Reject
                                  </button>
                                </Form>
                              </div>
                            )}
                            {isMarketplace && isDraft && !open && (
                              <button
                                type="button"
                                className="nx-secondary"
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  marginTop: 4,
                                }}
                                onClick={() => setExpandedId(product.id)}
                              >
                                Show approval actions
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`nx-badge ${status.tone}`}>
                          {status.label}
                        </span>
                      </td>
                      <td>
                        {inventory.toLocaleString()}
                        <span className="nx-secondary">
                          {" "}
                          / {variantCount} var
                        </span>
                      </td>
                      <td>{vendorLabel}</td>
                      <td>
                        <span className={`nx-badge ${approval.tone}`}>
                          {approval.label}
                        </span>
                      </td>
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
