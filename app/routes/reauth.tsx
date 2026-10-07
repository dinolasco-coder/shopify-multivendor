import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

/**
 * Top-level reauth — escape the Admin iframe and send the merchant to Shopify
 * to approve shipping (and other) scopes.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") || "").trim().toLowerCase();
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const scopes = (process.env.SCOPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const appUrl = (process.env.SHOPIFY_APP_URL || url.origin).replace(/\/$/, "");

  if (!shop || !shop.includes(".") || !apiKey) {
    return new Response(
      `<!doctype html><html><body style="font-family:system-ui;padding:32px">
        <h1>Cannot re-authorize</h1>
        <p>Missing shop or app credentials. Open Multivendor from Shopify Admin → Settings, then try again.</p>
        <p><a href="${appUrl}/app/settings">Back to Settings</a></p>
      </body></html>`,
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  const redirectUri = `${appUrl}/auth/callback`;

  // 1) Prefer Admin grant URL for optional shipping scopes (works post-install).
  const optionalInstall = new URL(
    `https://admin.shopify.com/store/${storeHandle}/oauth/install`,
  );
  optionalInstall.searchParams.set("client_id", apiKey);
  optionalInstall.searchParams.set(
    "optional_scopes",
    "read_shipping,write_shipping",
  );

  // 2) Classic authorize URL as fallback (full scope list + callback).
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set("client_id", apiKey);
  if (scopes.length) {
    authorize.searchParams.set("scope", scopes.join(","));
  }
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", crypto.randomUUID());

  // Use optional install first; if Shopify rejects undeclared optional scopes,
  // merchant can use the authorize link from Settings.
  const mode = (url.searchParams.get("mode") || "optional").toLowerCase();
  throw redirect(
    mode === "full" ? authorize.toString() : optionalInstall.toString(),
  );
};
