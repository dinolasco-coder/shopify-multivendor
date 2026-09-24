import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = getVendorSessionToken(request);
  const vendor = await getVendorFromSessionToken(token);
  if (vendor) {
    throw redirect(vendor.status === "approved" ? "/vendor" : "/vendor/pending");
  }
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const originError = assertSameOrigin(request);
  if (originError) return { error: originError };

  const key = registerAttemptKey(request);
  const limit = checkRateLimit(key, REGISTER_MAX_ATTEMPTS, REGISTER_WINDOW_MS);
  if (!limit.allowed) {
    return { error: limit.message, locked: true };
  }

  const form = await request.formData();
  const shop = String(form.get("shop") || "").trim().toLowerCase();
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");

  if (!shop || !name || !email || password.length < 8) {
    recordFailedAttempt(
      key,
      REGISTER_MAX_ATTEMPTS,
      REGISTER_WINDOW_MS,
      REGISTER_LOCK_MS,
    );
    return {
      error: "Shop, business name, email, and password (8+ chars) are required.",
    };
  }

  const normalizedShop = shop.includes(".")
    ? shop
    : `${shop}.myshopify.com`;

  const existing = await getVendorByEmail(normalizedShop, email);
  if (existing) {
    recordFailedAttempt(
      key,
      REGISTER_MAX_ATTEMPTS,
      REGISTER_WINDOW_MS,
      REGISTER_LOCK_MS,
    );
    return { error: "An account with that email already exists for this shop." };
  }

  const settings = await getOrCreateSettings(normalizedShop);
  const vendor = await createVendor({
    shop: normalizedShop,
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
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [shop, setShop] = useState("");
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

          {actionData?.error && (
            <Banner tone="critical">{actionData.error}</Banner>
          )}

          <Form method="post">
            <input type="hidden" name="shop" value={shop} />
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="password" value={password} />
            <BlockStack gap="400">
              <TextField
                label="Shop"
                value={shop}
                onChange={setShop}
                autoComplete="organization"
                placeholder="your-store.myshopify.com"
                helpText="example.myshopify.com"
              />
              <TextField
                label="Store name"
                value={name}
                onChange={setName}
                autoComplete="organization"
                placeholder="Your business name"
              />
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                placeholder="Email"
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                placeholder="Password"
                helpText="At least 8 characters"
              />
              <Button
                submit
                variant="primary"
                size="large"
                fullWidth
                loading={busy}
                disabled={Boolean(actionData && "locked" in actionData && actionData.locked)}
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
