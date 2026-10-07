import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getOrCreateSettings,
  updateSettings,
} from "../models/settings.server";

function appBaseUrl(request: Request) {
  return (
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, scopes } = await authenticate.admin(request);
  const settings = await getOrCreateSettings(session.shop);
  const base = appBaseUrl(request);
  const scopesConfigured = (process.env.SCOPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let sessionScopes = (session.scope || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const detail = await scopes.query();
    if (detail.granted?.length) sessionScopes = detail.granted;
  } catch {
    // Fall back to session.scope if Admin API query fails.
  }
  const need = [
    "read_merchant_managed_fulfillment_orders",
    "write_merchant_managed_fulfillment_orders",
  ];
  const needShipping = ["read_shipping", "write_shipping"];
  const envHasFulfillment = need.every((s) => scopesConfigured.includes(s));
  const sessionHasFulfillment = need.every((s) => sessionScopes.includes(s));
  const envHasShipping = needShipping.every((s) =>
    scopesConfigured.includes(s),
  );
  const sessionHasShipping = needShipping.every((s) =>
    sessionScopes.includes(s),
  );

  const storeHandle = session.shop.replace(/\.myshopify\.com$/i, "");
  // Escape iframe → /reauth → Shopify grant screen
  const reauthUrl = `${base}/reauth?shop=${encodeURIComponent(session.shop)}`;
  const reauthFullUrl = `${reauthUrl}&mode=full`;
  const adminOptionalUrl = `https://admin.shopify.com/store/${storeHandle}/oauth/install?client_id=${encodeURIComponent(
    process.env.SHOPIFY_API_KEY || "",
  )}&optional_scopes=${encodeURIComponent("read_shipping,write_shipping")}`;

  return {
    settings,
    registerUrl: `${base}/vendor/register`,
    loginUrl: `${base}/vendor/login`,
    shop: session.shop,
    scopesConfigured,
    sessionScopes,
    hasFulfillmentScopes: envHasFulfillment,
    sessionHasFulfillmentScopes: sessionHasFulfillment,
    hasShippingScopes: envHasShipping,
    sessionHasShippingScopes: sessionHasShipping,
    reauthUrl,
    reauthFullUrl,
    adminOptionalUrl,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, scopes } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "save");

  if (intent === "request-shipping-scopes") {
    try {
      // Shopify shows a grant modal / redirect for optional scopes.
      await scopes.request(["read_shipping", "write_shipping"]);
      return {
        ok: true,
        message:
          "Shipping permissions requested. If you approved them, refresh this page.",
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not open Shopify permission screen. Use the Re-authorize link below (opens outside the app).",
      };
    }
  }

  const defaultCommissionPercent = Number(form.get("defaultCommissionPercent"));
  const requireProductApproval = form.get("requireProductApproval") === "on";
  const allowPublicRegistration = form.get("allowPublicRegistration") === "on";
  const defaultCommissionFlat = Number(form.get("defaultCommissionFlat") || 0);

  if (
    !Number.isFinite(defaultCommissionPercent) ||
    defaultCommissionPercent < 0 ||
    defaultCommissionPercent > 100
  ) {
    return { error: "Default commission % must be between 0 and 100." };
  }
  if (!Number.isFinite(defaultCommissionFlat) || defaultCommissionFlat < 0) {
    return { error: "Flat commission must be 0 or greater." };
  }

  const settings = await updateSettings(session.shop, {
    defaultCommissionPercent,
    requireProductApproval,
    allowPublicRegistration,
    defaultCommissionFlat,
  });

  return { ok: true, settings, message: "Settings saved." };
};

const styles = `
  .nx-set { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-set__title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .nx-set__sub { margin: 0 0 18px; color: #6d7175; font-size: 14px; }
  .nx-panel { background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .nx-panel h2 { margin: 0 0 6px; font-size: 16px; }
  .nx-panel p { margin: 0 0 14px; color: #6d7175; font-size: 13px; line-height: 1.45; }
  .nx-field { margin-bottom: 14px; }
  .nx-field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  .nx-field input[type="number"] {
    width: 100%; max-width: 280px; box-sizing: border-box; border: 1px solid #c9cccf;
    border-radius: 8px; padding: 9px 10px; font-size: 14px;
  }
  .nx-check { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 12px; font-size: 14px; }
  .nx-btn {
    border: none; background: #1a1a1a; color: #fff; border-radius: 8px;
    padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .nx-btn:disabled { opacity: 0.6; }
  .nx-link { color: #2c6ecb; word-break: break-all; font-size: 13px; }
  .nx-banner { margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
  .nx-banner.err { background: #fbeae9; color: #8e1f0b; }
  .nx-banner.ok { background: #e4f7e9; color: #0d6b2d; }
`;

export default function SettingsPage() {
  const {
    settings,
    registerUrl,
    loginUrl,
    scopesConfigured,
    sessionScopes,
    hasFulfillmentScopes,
    sessionHasFulfillmentScopes,
    hasShippingScopes,
    sessionHasShippingScopes,
    reauthUrl,
    reauthFullUrl,
    adminOptionalUrl,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const current =
    actionData && "settings" in actionData && actionData.settings
      ? actionData.settings
      : settings;
  const scopesText = scopesConfigured.join(",");

  return (
    <s-page heading="Settings">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-set">
        <h1 className="nx-set__title">Settings</h1>
        <p className="nx-set__sub">
          Commission defaults, product approval, and seller registration links.
        </p>

        {actionData && "error" in actionData && actionData.error && (
          <div className="nx-banner err">{actionData.error}</div>
        )}
        {actionData && "message" in actionData && actionData.message && (
          <div className="nx-banner ok">{actionData.message}</div>
        )}

        {!hasFulfillmentScopes ? (
          <div className="nx-banner err">
            Railway <strong>SCOPES</strong> is still missing fulfillment. Paste
            the value below into Railway Variables, save, redeploy, then use
            Re-authorize.
          </div>
        ) : !sessionHasFulfillmentScopes ? (
          <div className="nx-banner err">
            Server SCOPES are OK, but this shop’s token is still old. Click{" "}
            <strong>Re-authorize Shopify permissions</strong> below and approve
            the popup.
          </div>
        ) : (
          <div className="nx-banner ok">
            Fulfillment permissions look ready for this shop.
          </div>
        )}

        {!hasShippingScopes ? (
          <div className="nx-banner err">
            Railway <strong>SCOPES</strong> is missing{" "}
            <strong>read_shipping,write_shipping</strong>. Add them, redeploy,
            then Re-authorize — needed so seller products can show Ship at
            checkout.
          </div>
        ) : !sessionHasShippingScopes ? (
          <div className="nx-banner err">
            Shipping scopes are on the server, but this shop has not approved
            them yet. Click <strong>Re-authorize Shopify permissions</strong>{" "}
            and accept shipping access.
          </div>
        ) : (
          <div className="nx-banner ok">
            Shipping permissions look ready for this shop.
          </div>
        )}

        <Form method="post">
          <div className="nx-panel">
            <h2>Commission</h2>
            <p>
              Applied to newly invited or registered sellers. Override per
              seller on the Sellers page.
            </p>
            <div className="nx-field">
              <label htmlFor="defaultCommissionPercent">
                Default commission %
              </label>
              <input
                id="defaultCommissionPercent"
                name="defaultCommissionPercent"
                type="number"
                min={0}
                max={100}
                step={0.1}
                defaultValue={current.defaultCommissionPercent}
                required
              />
            </div>
            <div className="nx-field">
              <label htmlFor="defaultCommissionFlat">
                Optional flat fee per attributed order (same currency as orders)
              </label>
              <input
                id="defaultCommissionFlat"
                name="defaultCommissionFlat"
                type="number"
                min={0}
                step={0.01}
                defaultValue={
                  "defaultCommissionFlat" in current
                    ? String((current as { defaultCommissionFlat?: number }).defaultCommissionFlat ?? 0)
                    : "0"
                }
              />
            </div>
          </div>

          <div className="nx-panel">
            <h2>Products</h2>
            <label className="nx-check">
              <input
                type="checkbox"
                name="requireProductApproval"
                defaultChecked={Boolean(current.requireProductApproval)}
              />
              <span>
                Require admin approval before seller products go live (creates
                drafts until you Approve on Products)
              </span>
            </label>
          </div>

          <div className="nx-panel">
            <h2>Seller registration</h2>
            <label className="nx-check">
              <input
                type="checkbox"
                name="allowPublicRegistration"
                defaultChecked={
                  "allowPublicRegistration" in current
                    ? Boolean(
                        (current as { allowPublicRegistration?: boolean })
                          .allowPublicRegistration ?? true,
                      )
                    : true
                }
              />
              <span>Allow public seller registration link</span>
            </label>
            <p>
              Login:{" "}
              <a className="nx-link" href={loginUrl} target="_blank" rel="noreferrer">
                {loginUrl}
              </a>
            </p>
            <p>
              Register:{" "}
              <a className="nx-link" href={registerUrl} target="_blank" rel="noreferrer">
                {registerUrl}
              </a>
            </p>
          </div>

          <div className="nx-panel">
            <h2>Payouts</h2>
            <p style={{ marginBottom: 0 }}>
              Record seller payouts on the Payouts page (manual bank/GCash).
            </p>
          </div>

          <button className="nx-btn" type="submit" disabled={busy}>
            {busy &&
            navigation.formData?.get("intent") !== "request-shipping-scopes"
              ? "Saving…"
              : "Save settings"}
          </button>
        </Form>

        <div className="nx-panel" style={{ marginTop: 16 }}>
          <h2>Fulfillment &amp; shipping permissions</h2>
          <p>
            Seller fulfill + Ship checkout need these scopes on{" "}
            <strong>Railway</strong> and approved on this shop.
          </p>
          <p>Railway SCOPES (copy/paste):</p>
          <code
            style={{
              display: "block",
              fontSize: 11,
              background: "#f6f6f7",
              border: "1px solid #e4e5e7",
              borderRadius: 8,
              padding: 10,
              wordBreak: "break-all",
              marginBottom: 10,
            }}
          >
            {scopesText || "(SCOPES env not set on this server)"}
          </code>
          <p>
            Server has fulfillment scopes:{" "}
            <strong>{hasFulfillmentScopes ? "Yes" : "No"}</strong>
            <br />
            This shop token has fulfillment scopes:{" "}
            <strong>{sessionHasFulfillmentScopes ? "Yes" : "No"}</strong>
            <br />
            Server has shipping scopes:{" "}
            <strong>{hasShippingScopes ? "Yes" : "No"}</strong>
            <br />
            This shop token has shipping scopes:{" "}
            <strong>{sessionHasShippingScopes ? "Yes" : "No"}</strong>
          </p>
          <p style={{ fontSize: 12, color: "#6d7175" }}>
            Shop token scopes:{" "}
            {sessionScopes.length ? sessionScopes.join(", ") : "(none)"}
          </p>
          <p style={{ fontSize: 13, color: "#6d7175" }}>
            Prefer the button first. If it does nothing, open a link in a{" "}
            <strong>new tab</strong> (not inside the app frame).
          </p>
          <Form method="post" style={{ marginTop: 8 }}>
            <input
              type="hidden"
              name="intent"
              value="request-shipping-scopes"
            />
            <button className="nx-btn" type="submit" disabled={busy}>
              {busy &&
              navigation.formData?.get("intent") === "request-shipping-scopes"
                ? "Opening…"
                : "Request shipping permissions"}
            </button>
          </Form>
          <p style={{ marginTop: 12, fontSize: 13 }}>
            <a
              className="nx-link"
              href={reauthUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open permission page (new tab)
            </a>
            {" · "}
            <a
              className="nx-link"
              href={adminOptionalUrl}
              target="_blank"
              rel="noreferrer"
            >
              Shopify Admin grant link
            </a>
            {" · "}
            <a
              className="nx-link"
              href={reauthFullUrl}
              target="_blank"
              rel="noreferrer"
            >
              Full re-install authorize
            </a>
          </p>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
