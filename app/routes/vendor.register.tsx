import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  createVendor,
  getVendorByEmail,
} from "../models/vendor.server";
import { getOrCreateSettings } from "../models/settings.server";
import { hashPassword } from "../services/password.server";
import {
  getVendorSessionToken,
  startVendorSession,
} from "../services/vendor-auth.server";
import { getVendorFromSessionToken } from "../models/vendor-session.server";
import { VendorAuthShell, ShopifyMark } from "../components/VendorAuthShell";
import {
  REGISTER_LOCK_MS,
  REGISTER_MAX_ATTEMPTS,
  REGISTER_WINDOW_MS,
  assertSameOrigin,
  checkRateLimit,
  clearAttempts,
  recordFailedAttempt,
  registerAttemptKey,
} from "../services/login-rate-limit.server";
import { resolveVendorPortalShop } from "../services/portal-shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = getVendorSessionToken(request);
  const vendor = await getVendorFromSessionToken(token);
  if (vendor) {
    throw redirect(vendor.status === "approved" ? "/vendor" : "/vendor/pending");
  }

  const portalShop = await resolveVendorPortalShop();
  if (!portalShop) {
    return {
      portalShop: null as string | null,
      error:
        "Vendor portal shop is not configured. Set VENDOR_PORTAL_SHOP on the server (e.g. your-store.myshopify.com).",
    };
  }

  return { portalShop, error: null as string | null };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const originError = assertSameOrigin(request);
  if (originError) return { error: originError };

  const portalShop = await resolveVendorPortalShop();
  if (!portalShop) {
    return {
      error:
        "Vendor portal shop is not configured. Set VENDOR_PORTAL_SHOP on the server.",
    };
  }

  const key = registerAttemptKey(request);
  const limit = checkRateLimit(key, REGISTER_MAX_ATTEMPTS, REGISTER_WINDOW_MS);
  if (!limit.allowed) {
    return { error: limit.message, locked: true };
  }

  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");

  if (!name || !email || password.length < 8) {
    recordFailedAttempt(
      key,
      REGISTER_MAX_ATTEMPTS,
      REGISTER_WINDOW_MS,
      REGISTER_LOCK_MS,
    );
    return {
      error: "Business name, email, and password (8+ chars) are required.",
    };
  }

  const existing = await getVendorByEmail(portalShop, email);
  if (existing) {
    recordFailedAttempt(
      key,
      REGISTER_MAX_ATTEMPTS,
      REGISTER_WINDOW_MS,
      REGISTER_LOCK_MS,
    );
    return { error: "An account with that email already exists." };
  }

  const settings = await getOrCreateSettings(portalShop);
  const vendor = await createVendor({
    shop: portalShop,
    name,
    email,
    passwordHash: hashPassword(password),
    commissionPercent: settings.defaultCommissionPercent,
    status: "pending",
  });

  clearAttempts(key);

  const { cookie } = await startVendorSession(vendor.id);
  return redirect("/vendor/pending", {
    headers: { "Set-Cookie": cookie },
  });
};

export default function VendorRegister() {
  const { portalShop, error: loaderError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <VendorAuthShell>
      <div className="vendor-auth-card">
        <BlockStack gap="500">
          <div className="vendor-auth-brand">
            <ShopifyMark />
            <Text as="h1" variant="headingXl" alignment="center">
              Create account
            </Text>
            <Text as="p" tone="subdued" alignment="center">
              Start selling on this store. An admin will approve you first.
            </Text>
          </div>

          {(loaderError || actionData?.error) && (
            <Banner tone="critical">{loaderError || actionData?.error}</Banner>
          )}

          {portalShop && (
            <Text as="p" tone="subdued" alignment="center">
              Store: {portalShop}
            </Text>
          )}

          <Form method="post">
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="password" value={password} />
            <BlockStack gap="400">
              <TextField
                label="Store name"
                value={name}
                onChange={setName}
                autoComplete="organization"
                placeholder="Your business name"
                disabled={!portalShop}
              />
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                placeholder="Email"
                disabled={!portalShop}
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                placeholder="Password"
                helpText="At least 8 characters"
                disabled={!portalShop}
              />
              <Button
                submit
                variant="primary"
                size="large"
                fullWidth
                loading={busy}
                disabled={
                  !portalShop ||
                  Boolean(actionData && "locked" in actionData && actionData.locked)
                }
              >
                Create account
              </Button>
            </BlockStack>
          </Form>

          <div className="vendor-auth-footer">
            <Text as="p" alignment="center">
              Already have an account?{" "}
              <Link to="/vendor/login" className="vendor-auth-link">
                Log in
              </Link>
            </Text>
          </div>
        </BlockStack>
      </div>
    </VendorAuthShell>
  );
}
