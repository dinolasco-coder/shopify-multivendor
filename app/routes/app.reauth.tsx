import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Clears the shop session then starts OAuth at the TOP of the browser
 * (outside the Admin iframe). In-iframe /auth redirects show a blank page.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  await prisma.session.deleteMany({ where: { shop } });

  const base =
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin;
  const authUrl = `${base}/auth?shop=${encodeURIComponent(shop)}`;

  return new Response(
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Re-authorize…</title>
    <script>
      window.top.location.href = ${JSON.stringify(authUrl)};
    </script>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; color: #202223;">
    <p>Opening Shopify to approve permissions…</p>
    <p>
      If nothing happens,
      <a href="${authUrl.replace(/"/g, "&quot;")}">click here</a>.
    </p>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "frame-ancestors https://admin.shopify.com https://*.myshopify.com;",
      },
    },
  );
};
