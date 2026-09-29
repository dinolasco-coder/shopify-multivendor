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
  const { session } = await authenticate.admin(request);
  const settings = await getOrCreateSettings(session.shop);
  const base = appBaseUrl(request);
  return {
    settings,
    registerUrl: `${base}/vendor/register`,
    loginUrl: `${base}/vendor/login`,
    scopesConfigured: (process.env.SCOPES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    hasFulfillmentScopes: Boolean(
      process.env.SCOPES?.includes("read_merchant_managed_fulfillment_orders") &&
        process.env.SCOPES?.includes(
          "write_merchant_managed_fulfillment_orders",
        ),
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
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
    hasFulfillmentScopes,
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
            Fulfillment scopes are missing on this server. Set Railway{" "}
            <strong>SCOPES</strong> (see panel below), redeploy, then reopen
            Multivendor here so Shopify can ask you to approve permissions.
          </div>
        ) : (
          <div className="nx-banner ok">
            Server SCOPES include fulfillment. If sellers still see Access
            denied, open this Multivendor app from Shopify Admin once and
            approve any permission prompt.
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
            <h2>Payouts &amp; shipping</h2>
            <p>
              Record seller payouts on the Payouts page (manual bank/GCash).
              Sellers can mark orders fulfilled in the seller portal (tracking +
              carrier + URL).
            </p>
            <p>
              <strong>Railway SCOPES</strong> (paste into Variables, then
              redeploy). After that, reopen Multivendor in Shopify Admin and
              approve permissions:
            </p>
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
            <p style={{ marginBottom: 0 }}>
              Live server has fulfillment scopes:{" "}
              <strong>{hasFulfillmentScopes ? "Yes" : "No"}</strong>
            </p>
          </div>

          <button className="nx-btn" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </Form>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
