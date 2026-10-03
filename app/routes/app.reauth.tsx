import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Legacy /app/reauth — send merchants to the top-level /reauth page
 * (returning raw HTTP 200 HTML here showed a bare "200" in Admin).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const base =
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin;
  throw redirect(
    `${base}/reauth?shop=${encodeURIComponent(session.shop)}`,
  );
};
