import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useEffect } from "react";
import prisma from "../db.server";

/**
 * Top-level reauth (NOT under /app) so OAuth is not trapped in the Admin iframe.
 * Clears stored sessions for the shop, then sends the browser to /auth.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") || "").trim().toLowerCase();

  if (!shop || !shop.includes(".")) {
    return {
      error: "Missing shop. Open Multivendor from Shopify Admin → Settings, then try again.",
      authUrl: null as string | null,
    };
  }

  await prisma.session.deleteMany({ where: { shop } });

  const base =
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") || url.origin;
  const authUrl = `${base}/auth?shop=${encodeURIComponent(shop)}`;

  return { error: null as string | null, authUrl, shop };
};

export default function ReauthPage() {
  const { error, authUrl, shop } = useLoaderData<typeof loader>();

  useEffect(() => {
    if (!authUrl) return;
    const target = window.top ?? window;
    target.location.href = authUrl;
  }, [authUrl]);

  if (error) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h1>Cannot re-authorize</h1>
        <p>{error}</p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1>Re-authorize Multivendor</h1>
      <p>
        Clearing old permissions for <strong>{shop}</strong>, then opening
        Shopify…
      </p>
      <p>
        If you are not redirected,{" "}
        <a href={authUrl!} target="_top" rel="noreferrer">
          click here to continue
        </a>
        .
      </p>
    </main>
  );
}
