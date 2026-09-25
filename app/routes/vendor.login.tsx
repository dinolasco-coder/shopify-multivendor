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

  const form = await request.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const key = loginAttemptKey(portalShop, email, request);
  const limit = checkRateLimit(key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
  if (!limit.allowed) {
    return { error: limit.message, locked: true };
  }

  const vendor = await getVendorByEmail(portalShop, email);
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
          ? `Invalid email or password. ${left} attempt(s) left before a temporary lock.`
          : "Invalid email or password.",
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
  const { portalShop, error: loaderError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
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

          {(loaderError || actionData?.error) && (
            <Banner tone="critical">{loaderError || actionData?.error}</Banner>
          )}

          {portalShop && (
            <Text as="p" tone="subdued" alignment="center">
              Store: {portalShop}
            </Text>
          )}

          <Form method="post">
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="password" value={password} />
            <BlockStack gap="400">
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
                autoComplete="current-password"
                placeholder="Password"
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
