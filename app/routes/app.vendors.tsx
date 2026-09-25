import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  createVendor,
  deleteVendor,
  listVendors,
  updateVendor,
  getVendorByEmail,
  getVendorById,
} from "../models/vendor.server";
import { getOrCreateSettings } from "../models/settings.server";
import { hashPassword } from "../services/password.server";
import { ensureVendorCollection } from "../services/collections.server";
import type { VendorStatus } from "../constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const vendors = await listVendors(session.shop);
  const settings = await getOrCreateSettings(session.shop);
  return { vendors, settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

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
          "A vendor with that email already exists. Use “Reset password” on their card, or Delete them first then invite again.",
      };
    }

    const settings = await getOrCreateSettings(session.shop);
    await createVendor({
      shop: session.shop,
      name,
      email,
      passwordHash: hashPassword(password),
      commissionPercent: Number.isFinite(commission)
        ? commission
        : settings.defaultCommissionPercent,
      status: "pending",
    });

    return {
      ok: true,
      message: `Vendor invited. Share ${new URL(request.url).origin}/vendor/login and the temporary password with ${email}.`,
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

    return {
      ok: true,
      message: `Password reset for ${vendor.email}. Temporary password: ${temporaryPassword}`,
    };
  }

  return { error: "Unknown action." };
};

export default function VendorsPage() {
  const { vendors, settings } = useLoaderData<typeof loader>();
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

      <s-section heading="Invite vendor">
        <Form method="post">
          <input type="hidden" name="intent" value="invite" />
          <s-stack direction="block" gap="base">
            <s-text-field label="Business name" name="name" required />
            <s-email-field label="Email" name="email" required />
            <s-password-field
              label="Temporary password"
              name="password"
              required
              details="Minimum 8 characters. Share this with the vendor manually (login link + password)."
            />
            <s-number-field
              label="Commission %"
              name="commissionPercent"
              value={String(settings.defaultCommissionPercent)}
              min={0}
              max={100}
              step={0.1}
            />
            <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
              Invite vendor
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="All vendors">
        {vendors.length === 0 ? (
          <s-paragraph>
            No vendors yet. Invite your first seller above, or ask them to
            register at /vendor/register.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {vendors.map((vendor) => (
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
                  <s-paragraph>
                    {vendor.email} · Commission {vendor.commissionPercent}%
                  </s-paragraph>

                  <s-stack direction="inline" gap="base">
                    <Form method="post">
                      <input type="hidden" name="intent" value="resetPassword" />
                      <input type="hidden" name="vendorId" value={vendor.id} />
                      <s-button type="submit">Reset password</s-button>
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
                    {vendor.status !== "rejected" && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="setStatus" />
                        <input type="hidden" name="vendorId" value={vendor.id} />
                        <input type="hidden" name="status" value="rejected" />
                        <s-button type="submit" tone="critical">
                          Reject
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
                    <Form
                      method="post"
                      onSubmit={(event) => {
                        if (
                          !confirm(
                            `Delete ${vendor.name}? Their login, sales records, and payouts for this vendor will be removed. This cannot be undone.`,
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
                      <s-number-field
                        label="Commission %"
                        name="commissionPercent"
                        value={String(vendor.commissionPercent)}
                        min={0}
                        max={100}
                        step={0.1}
                      />
                      <s-button type="submit">Update commission</s-button>
                    </s-stack>
                  </Form>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
