import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Page,
  Text,
} from "@shopify/polaris";
import {
  ensureVendorSlug,
  getVendorBySlug,
} from "../models/vendor.server";
import { resolveVendorPortalShop } from "../services/portal-shop.server";
import {
  endVendorSession,
  getVendorSessionToken,
} from "../services/vendor-auth.server";
import { getVendorFromSessionToken } from "../models/vendor-session.server";

/**
 * Per-seller portal door: /vendor/u/:slug
 * - Correct seller logged in → their dashboard
 * - Another seller logged in → offer switch
 * - Logged out → login with seller hint
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const slug = String(params.slug || "")
    .trim()
    .toLowerCase();
  if (!slug) throw new Response("Not found", { status: 404 });

  const portalShop = await resolveVendorPortalShop();
  if (!portalShop) {
    throw new Response("Vendor portal shop is not configured.", { status: 503 });
  }

  let target = await getVendorBySlug(portalShop, slug);
  if (!target) {
    throw new Response("Seller not found", { status: 404 });
  }

  const ensuredSlug = await ensureVendorSlug(target);
  if (ensuredSlug !== target.slug) {
    target = { ...target, slug: ensuredSlug };
  }

  const token = getVendorSessionToken(request);
  const current = await getVendorFromSessionToken(token);

  if (current && current.id === target.id) {
    throw redirect(current.status === "approved" ? "/vendor" : "/vendor/pending");
  }

  if (current && current.id !== target.id) {
    return {
      mode: "switch" as const,
      targetName: target.name,
      targetSlug: target.slug,
      currentName: current.name,
    };
  }

  throw redirect(`/vendor/login?seller=${encodeURIComponent(target.slug)}`);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const clearCookie = await endVendorSession(request);
  const slug = String(params.slug || "").trim().toLowerCase();
  return redirect(`/vendor/login?seller=${encodeURIComponent(slug)}`, {
    headers: { "Set-Cookie": clearCookie },
  });
};

export default function VendorSlugDoor() {
  const data = useLoaderData<typeof loader>();

  if (data.mode !== "switch") return null;

  return (
    <Page title={`${data.targetName}'s portal`}>
      <Card>
        <BlockStack gap="400">
          <Banner tone="warning">
            You are signed in as <strong>{data.currentName}</strong>, not{" "}
            <strong>{data.targetName}</strong>.
          </Banner>
          <Text as="p">
            Log out to open {data.targetName}&apos;s seller dashboard, or stay
            in your current account.
          </Text>
          <BlockStack gap="200">
            <Form method="post">
              <Button submit variant="primary">
                Log out and open {data.targetName}
              </Button>
            </Form>
            <Button url="/vendor">Stay as {data.currentName}</Button>
          </BlockStack>
          <Text as="p" tone="subdued">
            Bookmark: /vendor/u/{data.targetSlug}
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
