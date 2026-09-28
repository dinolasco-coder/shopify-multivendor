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
import {
  createVendor,
  deleteVendor,
  ensureVendorSlug,
  listVendors,
  updateVendor,
  getVendorByEmail,
  getVendorById,
} from "../models/vendor.server";
import { getOrCreateSettings } from "../models/settings.server";
import { hashPassword } from "../services/password.server";
import { ensureVendorCollection } from "../services/collections.server";
import { listMarketplaceProducts } from "../services/products.server";
import type { VendorStatus } from "../constants";

function appBaseUrl(request: Request) {
  return (
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin
  );
}

function buildInviteKit(input: {
  name: string;
  email: string;
  password: string;
  portalUrl: string;
  shopLabel: string;
}) {
  return [
    `You're invited to sell on ${input.shopLabel}.`,
    ``,
    `Login link: ${input.portalUrl}`,
    `Email: ${input.email}`,
    `Temporary password: ${input.password}`,
    ``,
    `Steps:`,
    `1. Open the login link`,
    `2. Sign in with the email and temporary password`,
    `3. Wait until the store admin Approves your account`,
    `4. After approval, you can add products`,
    ``,
    `Hi ${input.name} - welcome!`,
  ].join("\n");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const vendors = await listVendors(session.shop);
  for (const v of vendors) {
    await ensureVendorSlug(v);
  }
  const refreshed = await listVendors(session.shop);
  const settings = await getOrCreateSettings(session.shop);
  const appUrl = appBaseUrl(request);

  const products = await listMarketplaceProducts(admin, { first: 100 }).catch(
    () => [],
  );
  const productCountByVendor: Record<string, number> = {};
  for (const p of products as Array<{ metafield?: { value?: string } | null }>) {
    const vendorId = p.metafield?.value;
    if (!vendorId) continue;
    productCountByVendor[vendorId] = (productCountByVendor[vendorId] ?? 0) + 1;
  }

  return {
    vendors: refreshed,
    settings,
    appUrl,
    productCountByVendor,
    sellerLoginUrl: `${appUrl}/vendor/login`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const baseUrl = appBaseUrl(request);
  const shopLabel = session.shop.replace(/\.myshopify\.com$/i, "");

  if (intent === "invite") {
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const commission = Number(form.get("commissionPercent"));

    if (!name || !email || password.length < 8) {
      return {
        error: "Name, email, and a password (8+ chars) are required.",
      };
    }

    const existing = await getVendorByEmail(session.shop, email);
    if (existing) {
      return {
        error:
          "A seller with that email already exists. Use Send login info on their row, or Delete them first then invite again.",
      };
    }

    const settings = await getOrCreateSettings(session.shop);
    const vendor = await createVendor({
      shop: session.shop,
      name,
      email,
      passwordHash: hashPassword(password),
      commissionPercent: Number.isFinite(commission)
        ? commission
        : settings.defaultCommissionPercent,
      commissionFlat: settings.defaultCommissionFlat ?? 0,
      status: "pending",
    });

    const slug = await ensureVendorSlug(vendor);
    const portalUrl = `${baseUrl}/vendor/u/${slug}`;
    const inviteKit = buildInviteKit({
      name,
      email,
      password,
      portalUrl,
      shopLabel,
    });

    return {
      ok: true,
      message: `Seller invited. Copy the invite message below and send it to ${email}.`,
      inviteKit,
    };
  }

  if (intent === "setStatus") {
    const vendorId = String(form.get("vendorId") || "");
    const status = String(form.get("status") || "") as VendorStatus;
    const vendor = await getVendorById(vendorId);
    if (!vendor || vendor.shop !== session.shop) {
      return { error: "Seller not found." };
    }

    let shopifyCollectionId = vendor.shopifyCollectionId;
    let shopifyCollectionHandle = vendor.shopifyCollectionHandle;
    if (status === "approved" && !shopifyCollectionId) {
      const collection = await ensureVendorCollection(admin, vendor);
      shopifyCollectionId = collection?.id ?? null;
      shopifyCollectionHandle = collection?.handle ?? null;
    }

    await updateVendor(vendorId, {
      status,
      shopifyCollectionId: shopifyCollectionId ?? undefined,
      shopifyCollectionHandle: shopifyCollectionHandle ?? undefined,
    });

    return { ok: true, message: `Seller marked as ${status}.` };
  }

  if (intent === "setCommission") {
    const vendorId = String(form.get("vendorId") || "");
    const commissionPercent = Number(form.get("commissionPercent"));
    const commissionFlat = Number(form.get("commissionFlat") || 0);
    const vendor = await getVendorById(vendorId);
    if (!vendor || vendor.shop !== session.shop) {
      return { error: "Seller not found." };
    }
    if (
      !Number.isFinite(commissionPercent) ||
      commissionPercent < 0 ||
      commissionPercent > 100
    ) {
      return { error: "Commission % must be between 0 and 100." };
    }
    if (!Number.isFinite(commissionFlat) || commissionFlat < 0) {
      return { error: "Flat commission must be 0 or greater." };
    }
    await updateVendor(vendorId, { commissionPercent, commissionFlat });
    return { ok: true, message: "Commission updated." };
  }

  if (intent === "delete") {
    const vendorId = String(form.get("vendorId") || "");
    const vendor = await getVendorById(vendorId);
    if (!vendor || vendor.shop !== session.shop) {
      return { error: "Seller not found." };
    }
    await deleteVendor(vendorId);
    return { ok: true, message: `${vendor.name} was deleted.` };
  }

  if (intent === "resetPassword") {
    const vendorId = String(form.get("vendorId") || "");
    const vendor = await getVendorById(vendorId);
    if (!vendor || vendor.shop !== session.shop) {
      return { error: "Seller not found." };
    }

    const temporaryPassword = `Tmp-${Math.random().toString(36).slice(2, 8)}A1`;
    await updateVendor(vendorId, {
      passwordHash: hashPassword(temporaryPassword),
    });

    const slug = await ensureVendorSlug(vendor);
    const portalUrl = `${baseUrl}/vendor/u/${slug}`;
    const inviteKit = buildInviteKit({
      name: vendor.name,
      email: vendor.email,
      password: temporaryPassword,
      portalUrl,
      shopLabel,
    });

    return {
      ok: true,
      message: `Login info ready for ${vendor.email}. Copy the message below and send it.`,
      inviteKit,
    };
  }

  return { error: "Unknown action." };
};

function CopyButton({
  label,
  text,
  primary,
}: {
  label: string;
  text: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className={primary ? "nx-btn nx-btn--primary" : "nx-btn"} onClick={copy}>
      {copied ? "Copied!" : label}
    </button>
  );
}

function statusBadge(status: string) {
  if (status === "approved") return { label: "Active", tone: "ok" };
  if (status === "pending") return { label: "Needs review", tone: "warn" };
  if (status === "rejected") return { label: "Rejected", tone: "bad" };
  if (status === "suspended") return { label: "Suspended", tone: "bad" };
  return { label: status, tone: "neutral" };
}

const styles = `
  .nx-sellers { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-sellers__head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 18px; flex-wrap: wrap; }
  .nx-sellers__title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .nx-sellers__sub { margin: 0; color: #6d7175; font-size: 14px; }
  .nx-sellers__actions { display: flex; gap: 10px; align-items: center; }
  .nx-link { color: #2c6ecb; text-decoration: none; font-size: 13px; font-weight: 600; }
  .nx-btn {
    border: 1px solid #c9cccf; background: #fff; color: #202223; border-radius: 8px;
    padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
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
  .nx-table td { padding: 14px 16px; border-bottom: 1px solid #ececec; vertical-align: top; font-size: 13px; }
  .nx-table tr:last-child td { border-bottom: none; }
  .nx-name { display: flex; gap: 12px; align-items: flex-start; }
  .nx-avatar {
    width: 36px; height: 36px; border-radius: 8px; background: #f1f2f3; color: #6d7175;
    display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;
  }
  .nx-primary { font-weight: 700; margin: 0 0 2px; }
  .nx-secondary { margin: 0; color: #6d7175; font-size: 12px; }
  .nx-muted { color: #8c9196; font-style: italic; }
  .nx-badge {
    display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 600; white-space: nowrap;
  }
  .nx-badge.ok { background: #e4f7e9; color: #0d6b2d; }
  .nx-badge.warn { background: #fff4d6; color: #8a6d00; }
  .nx-badge.bad { background: #fbeae9; color: #8e1f0b; }
  .nx-badge.neutral { background: #f1f2f3; color: #5c5f62; }
  .nx-row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .nx-empty { padding: 28px 16px; text-align: center; color: #6d7175; }
  .nx-banner { margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
  .nx-banner.err { background: #fbeae9; color: #8e1f0b; }
  .nx-banner.okmsg { background: #e4f7e9; color: #0d6b2d; }
  .nx-invite {
    background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; padding: 16px; margin-bottom: 16px;
  }
  .nx-invite h3 { margin: 0 0 10px; font-size: 16px; }
  .nx-invite-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .nx-invite label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  .nx-invite input {
    width: 100%; box-sizing: border-box; border: 1px solid #c9cccf; border-radius: 8px;
    padding: 8px 10px; font-size: 13px;
  }
  .nx-kit textarea {
    width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 13px;
    line-height: 1.45; padding: 12px; border-radius: 8px; border: 1px solid #c9cccf; background: #fff;
    resize: vertical; margin: 8px 0;
  }
  @media (max-width: 800px) {
    .nx-invite-grid { grid-template-columns: 1fr; }
    .nx-table { min-width: 720px; }
    .nx-panel { overflow-x: auto; }
  }
`;

export default function VendorsPage() {
  const { vendors, settings, appUrl, productCountByVendor, sellerLoginUrl } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tab = (searchParams.get("tab") || "all").toLowerCase();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors.filter((vendor) => {
      const count = productCountByVendor[vendor.id] ?? 0;
      if (tab === "needs_review" && vendor.status !== "pending") return false;
      if (tab === "pending_activation") {
        if (!(vendor.status === "approved" && count === 0)) return false;
      }
      if (tab === "rejected" && vendor.status !== "rejected") return false;
      if (!q) return true;
      return (
        vendor.name.toLowerCase().includes(q) ||
        vendor.email.toLowerCase().includes(q) ||
        (vendor.slug || "").toLowerCase().includes(q)
      );
    });
  }, [vendors, query, tab, productCountByVendor]);

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <s-page heading="Sellers">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-sellers">
        <div className="nx-sellers__head">
          <div>
            <h1 className="nx-sellers__title">Sellers</h1>
            <p className="nx-sellers__sub">
              Add sellers, set commissions, and manage their profiles
            </p>
          </div>
          <div className="nx-sellers__actions">
            <a className="nx-link" href={sellerLoginUrl} target="_blank" rel="noreferrer">
              Seller login
            </a>
            <button
              type="button"
              className="nx-btn nx-btn--primary"
              onClick={() => setShowInvite((v) => !v)}
            >
              + Add a seller
            </button>
          </div>
        </div>

        {actionData && "error" in actionData && actionData.error && (
          <div className="nx-banner err">{actionData.error}</div>
        )}
        {actionData && "message" in actionData && actionData.message && (
          <div className="nx-banner okmsg">{actionData.message}</div>
        )}

        {actionData && "inviteKit" in actionData && actionData.inviteKit && (
          <div className="nx-invite nx-kit">
            <h3>Invite message - copy &amp; send</h3>
            <p className="nx-secondary">
              Paste into Messenger, SMS, or email. No email service needed.
            </p>
            <textarea readOnly value={actionData.inviteKit} rows={11} />
            <CopyButton label="Copy invite message" text={actionData.inviteKit} primary />
          </div>
        )}

        {showInvite && (
          <div className="nx-invite">
            <h3>Invite a new seller</h3>
            <Form method="post">
              <input type="hidden" name="intent" value="invite" />
              <div className="nx-invite-grid">
                <div>
                  <label htmlFor="seller-name">Business name</label>
                  <input id="seller-name" name="name" required />
                </div>
                <div>
                  <label htmlFor="seller-email">Email</label>
                  <input id="seller-email" name="email" type="email" required />
                </div>
                <div>
                  <label htmlFor="seller-password">Temporary password</label>
                  <input
                    id="seller-password"
                    name="password"
                    type="password"
                    minLength={8}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="seller-commission">Commission %</label>
                  <input
                    id="seller-commission"
                    name="commissionPercent"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    defaultValue={settings.defaultCommissionPercent}
                  />
                </div>
              </div>
              <button className="nx-btn nx-btn--primary" type="submit" disabled={busy}>
                {busy ? "Inviting…" : "Invite seller"}
              </button>
            </Form>
          </div>
        )}

        <div className="nx-panel">
          <div className="nx-panel__inner">
            <div className="nx-tabs">
              {[
                { id: "all", label: "All" },
                { id: "needs_review", label: "Needs review" },
                { id: "pending_activation", label: "Pending activation" },
                { id: "rejected", label: "Rejected" },
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
                placeholder="Search any seller by their name, email, phone or brand"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="nx-empty">No sellers found. Add a seller to get started.</div>
          ) : (
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Brand</th>
                  <th>Product</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((vendor) => {
                  const count = productCountByVendor[vendor.id] ?? 0;
                  const badge = statusBadge(vendor.status);
                  const portalUrl = vendor.slug
                    ? `${appUrl}/vendor/u/${vendor.slug}`
                    : `${appUrl}/vendor/login`;
                  const open = expandedId === vendor.id;
                  const initial = (vendor.name || vendor.email || "?").charAt(0).toUpperCase();

                  return (
                    <tr key={vendor.id}>
                      <td>
                        <div className="nx-name">
                          <div className="nx-avatar">{initial}</div>
                          <div>
                            <button
                              type="button"
                              className="nx-primary"
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                              onClick={() =>
                                setExpandedId(open ? null : vendor.id)
                              }
                            >
                              {vendor.name}
                            </button>
                            <p className="nx-secondary">{vendor.email}</p>
                            {open && (
                              <div className="nx-row-actions">
                                <CopyButton label="Copy portal link" text={portalUrl} />
                                <Form method="post">
                                  <input type="hidden" name="intent" value="resetPassword" />
                                  <input type="hidden" name="vendorId" value={vendor.id} />
                                  <button className="nx-btn" type="submit" disabled={busy}>
                                    Send login info
                                  </button>
                                </Form>
                                {vendor.status !== "approved" && (
                                  <Form method="post">
                                    <input type="hidden" name="intent" value="setStatus" />
                                    <input type="hidden" name="vendorId" value={vendor.id} />
                                    <input type="hidden" name="status" value="approved" />
                                    <button className="nx-btn nx-btn--primary" type="submit" disabled={busy}>
                                      Approve
                                    </button>
                                  </Form>
                                )}
                                {vendor.status === "approved" && (
                                  <Form method="post">
                                    <input type="hidden" name="intent" value="setStatus" />
                                    <input type="hidden" name="vendorId" value={vendor.id} />
                                    <input type="hidden" name="status" value="suspended" />
                                    <button className="nx-btn" type="submit" disabled={busy}>
                                      Suspend
                                    </button>
                                  </Form>
                                )}
                                {vendor.status === "suspended" && (
                                  <Form method="post">
                                    <input type="hidden" name="intent" value="setStatus" />
                                    <input type="hidden" name="vendorId" value={vendor.id} />
                                    <input type="hidden" name="status" value="approved" />
                                    <button className="nx-btn nx-btn--primary" type="submit" disabled={busy}>
                                      Reinstate
                                    </button>
                                  </Form>
                                )}
                                {vendor.status !== "rejected" &&
                                  vendor.status !== "approved" && (
                                    <Form method="post">
                                      <input type="hidden" name="intent" value="setStatus" />
                                      <input type="hidden" name="vendorId" value={vendor.id} />
                                      <input type="hidden" name="status" value="rejected" />
                                      <button className="nx-btn nx-btn--danger" type="submit" disabled={busy}>
                                        Reject
                                      </button>
                                    </Form>
                                  )}
                                <Form method="post">
                                  <input type="hidden" name="intent" value="setCommission" />
                                  <input type="hidden" name="vendorId" value={vendor.id} />
                                  <input
                                    name="commissionPercent"
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={0.1}
                                    defaultValue={vendor.commissionPercent}
                                    title="Commission %"
                                    style={{
                                      width: 72,
                                      padding: "7px 8px",
                                      borderRadius: 8,
                                      border: "1px solid #c9cccf",
                                    }}
                                  />
                                  <input
                                    name="commissionFlat"
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    defaultValue={
                                      "commissionFlat" in vendor
                                        ? String(
                                            (vendor as { commissionFlat?: number })
                                              .commissionFlat ?? 0,
                                          )
                                        : "0"
                                    }
                                    title="Flat fee"
                                    style={{
                                      width: 72,
                                      padding: "7px 8px",
                                      borderRadius: 8,
                                      border: "1px solid #c9cccf",
                                    }}
                                  />
                                  <button className="nx-btn" type="submit" disabled={busy}>
                                    Save % + flat
                                  </button>
                                </Form>
                                <Form
                                  method="post"
                                  onSubmit={(event) => {
                                    if (
                                      !confirm(
                                        `Delete ${vendor.name}? This cannot be undone.`,
                                      )
                                    ) {
                                      event.preventDefault();
                                    }
                                  }}
                                >
                                  <input type="hidden" name="intent" value="delete" />
                                  <input type="hidden" name="vendorId" value={vendor.id} />
                                  <button className="nx-btn nx-btn--danger" type="submit" disabled={busy}>
                                    Delete
                                  </button>
                                </Form>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{vendor.name}</td>
                      <td>
                        {count > 0 ? (
                          count
                        ) : (
                          <span className="nx-muted">No products</span>
                        )}
                      </td>
                      <td>
                        <span className={`nx-badge ${badge.tone}`}>{badge.label}</span>
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
