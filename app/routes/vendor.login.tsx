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
import { getVendorByEmail } from "../models/vendor.server";
import { verifyPassword } from "../services/password.server";
import {
  getVendorSessionToken,
  startVendorSession,
} from "../services/vendor-auth.server";
import { getVendorFromSessionToken } from "../models/vendor-session.server";
import { VendorAuthShell, ShopifyMark } from "../components/VendorAuthShell";
import {
  LOGIN_LOCK_MS,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  assertSameOrigin,
  checkRateLimit,
  clearAttempts,
  loginAttemptKey,
  recordFailedAttempt,
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

  const form = await request.formData();
  const shop = String(form.get("shop") || "").trim().toLowerCase();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");

  if (!shop || !email || !password) {
    return { error: "Shop, email, and password are required." };
  }

  const normalizedShop = shop.includes(".")
    ? shop
    : `${shop}.myshopify.com`;

  const key = loginAttemptKey(normalizedShop, email, request);
  const limit = checkRateLimit(key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
  if (!limit.allowed) {
    return { error: limit.message, locked: true };
  }

  const vendor = await getVendorByEmail(normalizedShop, email);
  if (!vendor || !verifyPassword(password, vendor.passwordHash)) {
    const afterFail = recordFailedAttempt(
      key,
      LOGIN_MAX_ATTEMPTS,
      LOGIN_WINDOW_MS,
      LOGIN_LOCK_MS,
    );
    if (!afterFail.allowed) {
      return { error: afterFail.message, locked: true };
    }
    const left = afterFail.remaining;
    return {
      error:
        left <= 2
          ? `Invalid shop, email, or password. ${left} attempt(s) left before a temporary lock.`
          : "Invalid shop, email, or password.",
    };
  }

  if (vendor.status === "suspended") {
    return {
      error: "This account is suspended. Contact the store admin for help.",
    };
  }

  clearAttempts(key);

  const { cookie } = await startVendorSession(vendor.id);
  const dest = vendor.status === "approved" ? "/vendor" : "/vendor/pending";

  return redirect(dest, {
    headers: { "Set-Cookie": cookie },
  });
};

export default function VendorLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [shop, setShop] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <VendorAuthShell>
      <div className="vendor-auth-card">
        <BlockStack gap="500">
          <div className="vendor-auth-brand">
            <ShopifyMark />
            <Text as="h1" variant="headingXl" alignment="center">
              Log in
            </Text>
            <Text as="p" tone="subdued" alignment="center">
              Continue to your seller account
            </Text>
          </div>

          {actionData?.error && (
            <Banner tone="critical">{actionData.error}</Banner>
          )}

          <Form method="post">
            <input type="hidden" name="shop" value={shop} />
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
                autoComplete="current-password"
                placeholder="Password"
              />
              <Button
                submit
                variant="primary"
                size="large"
                fullWidth
                loading={busy}
                disabled={Boolean(actionData && "locked" in actionData && actionData.locked)}
              >
                Log in
              </Button>
            </BlockStack>
          </Form>

          <div className="vendor-auth-footer">
            <Text as="p" alignment="center">
              New seller?{" "}
              <Link to="/vendor/register" className="vendor-auth-link">
                Create account
              </Link>
            </Text>
          </div>
        </BlockStack>
      </div>
    </VendorAuthShell>
  );
}
