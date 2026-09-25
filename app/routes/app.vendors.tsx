import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  createVendor,
  deleteVendor,
  ensureVendorSlug,
  listVendors,
  updateVendor,
  getVendorByEmail,
  getVendorById,
} from "../models/vendor.server";
import { getOrCreateSettings } from "../models/settings.server";
import { hashPassword } from "../services/password.server";
import { ensureVendorCollection } from "../services/collections.server";
import type { VendorStatus } from "../constants";

function appBaseUrl(request: Request) {
  return (
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin
  );
}

function buildInviteKit(input: {
  name: string;
  email: string;
  password: string;
  portalUrl: string;
  shopLabel: string;
}) {
  return [
    `You're invited to sell on ${input.shopLabel}.`,
    ``,
    `Login link: ${input.portalUrl}`,
    `Email: ${input.email}`,
    `Temporary password: ${input.password}`,
    ``,
    `Steps:`,
    `1. Open the login link`,
    `2. Sign in with the email and temporary password`,
    `3. Wait until the store admin Approves your account`,
    `4. After approval, you can add products`,
    ``,
    `Hi ${input.name} — welcome!`,
  ].join("\n");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const vendors = await listVendors(session.shop);
  for (const v of vendors) {
    await ensureVendorSlug(v);
  }
  const refreshed = await listVendors(session.shop);
  const settings = await getOrCreateSettings(session.shop);
  const appUrl = appBaseUrl(request);
  return { vendors: refreshed, settings, appUrl };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const baseUrl = appBaseUrl(request);
  const shopLabel = session.shop.replace(/\.myshopify\.com$/i, "");

  if (intent === "invite") {
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const commission = Number(form.get("commissionPercent"));

    if (!name || !email || password.length < 8) {
      return {
        error: "Name, email, and a password (8+ chars) are required.",
      };
    }

    const existing = await getVendorByEmail(session.shop, email);
    if (existing) {
      return {
        error:
          "A vendor with that email already exists. Use “Send login info” on their card, or Delete them first then invite again.",
      };
    }

    const settings = await getOrCreateSettings(session.shop);
    const vendor = await createVendor({
      shop: session.shop,
      name,
      email,
      passwordHash: hashPassword(password),
      commissionPercent: Number.isFinite(commission)
        ? commission
        : settings.defaultCommissionPercent,
      status: "pending",
    });

    const slug = await ensureVendorSlug(vendor);
    const portalUrl = `${baseUrl}/vendor/u/${slug}`;
    const inviteKit = buildInviteKit({
      name,
      email,
      password,
      portalUrl,
      shopLabel,
    });

    return {
      ok: true,
      message: `Vendor invited. Copy the invite message below and send it to ${email}.`,
      inviteKit,
    };
  }

  if (intent === "setStatus") {
    const vendorId = String(form.get("vendorId") || "");
    const status = String(form.get("status") || "") as VendorStatus;
    const vendor = await getVendorById(vendorId);
    if (!vendor || vendor.shop !== session.shop) {
      return { error: "Vendor not found." };
    }

    let shopifyCollectionId = vendor.shopifyCollectionId;
    if (status === "approved" && !shopifyCollectionId) {
      shopifyCollectionId = await ensureVendorCollection(admin, vendor);
    }

    await updateVendor(vendorId, {
      status,
      shopifyCollectionId: shopifyCollectionId ?? undefined,
    });

    return { ok: true, message: `Vendor marked as ${status}.` };
  }

  if (intent === "setCommission") {
    const vendorId = String(form.get("vendorId") || "");
    const commissionPercent = Number(form.get("commissionPercent"));
    const vendor = await getVendorById(vendorId);
    if (!vendor || vendor.shop !== session.shop) {
      return { error: "Vendor not found." };
    }
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      return { error: "Commission must be between 0 and 100." };
    }
    await updateVendor(vendorId, { commissionPercent });
    return { ok: true, message: "Commission updated." };
  }

  if (intent === "delete") {
    const vendorId = String(form.get("vendorId") || "");
    const vendor = await getVendorById(vendorId);
    if (!vendor || vendor.shop !== session.shop) {
      return { error: "Vendor not found." };
    }
    await deleteVendor(vendorId);
    return { ok: true, message: `${vendor.name} was deleted.` };
  }

  if (intent === "resetPassword") {
    const vendorId = String(form.get("vendorId") || "");
    const vendor = await getVendorById(vendorId);
    if (!vendor || vendor.shop !== session.shop) {
      return { error: "Vendor not found." };
    }

    const temporaryPassword = `Tmp-${Math.random().toString(36).slice(2, 8)}A1`;
    await updateVendor(vendorId, {
      passwordHash: hashPassword(temporaryPassword),
    });

    const slug = await ensureVendorSlug(vendor);
    const portalUrl = `${baseUrl}/vendor/u/${slug}`;
    const inviteKit = buildInviteKit({
      name: vendor.name,
      email: vendor.email,
      password: temporaryPassword,
      portalUrl,
      shopLabel,
    });

    return {
      ok: true,
      message: `Login info ready for ${vendor.email}. Copy the message below and send it.`,
      inviteKit,
    };
  }

  return { error: "Unknown action." };
};

function CopyButton({
  label,
  text,
  primary,
}: {
  label: string;
  text: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      style={{
        padding: "8px 14px",
        borderRadius: "8px",
        border: primary ? "none" : "1px solid #c9cccf",
        background: primary ? "#1a1a1a" : "#fff",
        color: primary ? "#fff" : "#202223",
        fontWeight: 600,
        fontSize: "13px",
        cursor: "pointer",
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function InviteKitBox({ text }: { text: string }) {
  return (
    <s-section heading="Invite message — copy & send">
      <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Paste into Messenger, SMS, or email. No email service needed.
          </s-paragraph>
          <textarea
            id="vendor-invite-kit"
            readOnly
            value={text}
            rows={11}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: "ui-monospace, monospace",
              fontSize: "13px",
              lineHeight: 1.45,
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #c9cccf",
              background: "#fff",
              resize: "vertical",
            }}
          />
          <CopyButton label="Copy invite message" text={text} primary />
        </s-stack>
      </s-box>
    </s-section>
  );
}

export default function VendorsPage() {
  const { vendors, settings, appUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <s-page heading="Vendors">
      {actionData && "error" in actionData && actionData.error && (
        <s-banner tone="critical">{actionData.error}</s-banner>
      )}
      {actionData && "message" in actionData && actionData.message && (
        <s-banner tone="success">{actionData.message}</s-banner>
      )}
      {actionData && "inviteKit" in actionData && actionData.inviteKit && (
        <InviteKitBox text={actionData.inviteKit} />
      )}

      <s-section heading="Invite a new seller">
        <s-paragraph>
          Create their account, then copy the invite message and send it on
          Messenger or SMS.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="invite" />
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <div style={{ flex: 1, minWidth: 200 }}>
                <s-text-field label="Business name" name="name" required />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <s-email-field label="Email" name="email" required />
              </div>
            </s-stack>
            <s-stack direction="inline" gap="base">
              <div style={{ flex: 1, minWidth: 200 }}>
                <s-password-field
                  label="Temporary password"
                  name="password"
                  required
                  details="At least 8 characters"
                />
              </div>
              <div style={{ width: 140 }}>
                <s-number-field
                  label="Commission %"
                  name="commissionPercent"
                  value={String(settings.defaultCommissionPercent)}
                  min={0}
                  max={100}
                  step={0.1}
                />
              </div>
            </s-stack>
            <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
              Invite seller
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading={`Sellers (${vendors.length})`}>
        {vendors.length === 0 ? (
          <s-paragraph>
            No sellers yet. Invite one above, or share /vendor/register.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {vendors.map((vendor) => {
              const portalUrl = vendor.slug
                ? `${appUrl}/vendor/u/${vendor.slug}`
                : `${appUrl}/vendor/login`;

              return (
                <s-box
                  key={vendor.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base">
                      <s-heading>{vendor.name}</s-heading>
                      <s-badge
                        tone={
                          vendor.status === "approved"
                            ? "success"
                            : vendor.status === "pending"
                              ? "caution"
                              : "critical"
                        }
                      >
                        {vendor.status}
                      </s-badge>
                    </s-stack>

                    <s-paragraph>{vendor.email}</s-paragraph>

                    <s-stack direction="inline" gap="base">
                      <CopyButton label="Copy portal link" text={portalUrl} />
                      <Form method="post">
                        <input type="hidden" name="intent" value="resetPassword" />
                        <input type="hidden" name="vendorId" value={vendor.id} />
                        <s-button type="submit">Send login info</s-button>
                      </Form>
                      {vendor.status !== "approved" && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="setStatus" />
                          <input type="hidden" name="vendorId" value={vendor.id} />
                          <input type="hidden" name="status" value="approved" />
                          <s-button type="submit" variant="primary">
                            Approve
                          </s-button>
                        </Form>
                      )}
                      {vendor.status === "approved" && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="setStatus" />
                          <input type="hidden" name="vendorId" value={vendor.id} />
                          <input type="hidden" name="status" value="suspended" />
                          <s-button type="submit">Suspend</s-button>
                        </Form>
                      )}
                      {vendor.status === "suspended" && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="setStatus" />
                          <input type="hidden" name="vendorId" value={vendor.id} />
                          <input type="hidden" name="status" value="approved" />
                          <s-button type="submit" variant="primary">
                            Reinstate
                          </s-button>
                        </Form>
                      )}
                      {vendor.status !== "rejected" && vendor.status !== "approved" && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="setStatus" />
                          <input type="hidden" name="vendorId" value={vendor.id} />
                          <input type="hidden" name="status" value="rejected" />
                          <s-button type="submit" tone="critical">
                            Reject
                          </s-button>
                        </Form>
                      )}
                      <Form
                        method="post"
                        onSubmit={(event) => {
                          if (
                            !confirm(
                              `Delete ${vendor.name}? This cannot be undone.`,
                            )
                          ) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="vendorId" value={vendor.id} />
                        <s-button type="submit" tone="critical">
                          Delete
                        </s-button>
                      </Form>
                    </s-stack>

                    <Form method="post">
                      <input type="hidden" name="intent" value="setCommission" />
                      <input type="hidden" name="vendorId" value={vendor.id} />
                      <s-stack direction="inline" gap="base">
                        <div style={{ width: 140 }}>
                          <s-number-field
                            label="Commission %"
                            name="commissionPercent"
                            value={String(vendor.commissionPercent)}
                            min={0}
                            max={100}
                            step={0.1}
                          />
                        </div>
                        <s-button type="submit">Save commission</s-button>
                      </s-stack>
                    </Form>
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
