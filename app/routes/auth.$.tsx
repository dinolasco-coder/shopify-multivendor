import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect as rrRedirect } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

/**
 * Auth catch-all. Never return bare loader data (shows as JSON "null" in Admin).
 * Use the Shopify redirect helper so embedded / top-level navigation stays correct.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticate.admin(request);
  if ("redirect" in context && typeof context.redirect === "function") {
    return context.redirect("/app");
  }
  throw rrRedirect("/app");
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
