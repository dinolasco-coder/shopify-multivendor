import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

/**
 * Auth catch-all. authenticate.admin completes OAuth and redirects into the app.
 * Do not redirect to admin.shopify.com here — that URL cannot load inside the app iframe
 * ("admin.shopify.com refused to connect").
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
