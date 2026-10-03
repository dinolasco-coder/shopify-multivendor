import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Return into Shopify Admin embedded app (not a bare /app URL outside Admin).
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const shopHandle = session.shop.replace(/\.myshopify\.com$/i, "");
  if (apiKey && shopHandle) {
    throw redirect(
      `https://admin.shopify.com/store/${shopHandle}/apps/${apiKey}`,
    );
  }

  throw redirect("/app/settings");
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
