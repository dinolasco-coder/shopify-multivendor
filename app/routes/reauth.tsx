import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

/**
 * Top-level reauth — send the browser to Shopify's install / update-permissions
 * URL (not /auth), so new required scopes can be approved outside the Admin iframe.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") || "").trim().toLowerCase();
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const scopes = (process.env.SCOPES || "").trim();

  if (!shop || !shop.includes(".") || !apiKey) {
    return new Response(
      `<!doctype html><html><body style="font-family:system-ui;padding:32px">
        <h1>Cannot re-authorize</h1>
        <p>Missing shop or app credentials. Open Multivendor from Shopify Admin → Settings, then try again.</p>
      </body></html>`,
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const install = new URL(`https://${shop}/admin/oauth/install`);
  install.searchParams.set("client_id", apiKey);
  if (scopes) install.searchParams.set("scope", scopes);

  throw redirect(install.toString());
};
