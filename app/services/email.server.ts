import { Resend } from "resend";

function appBaseUrl() {
  return (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
}

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function fromAddress() {
  return (
    process.env.RESEND_FROM_EMAIL ||
    "Multi-vendor Inabel <onboarding@resend.dev>"
  );
}

export type InviteEmailInput = {
  to: string;
  vendorName: string;
  shop: string;
  temporaryPassword: string;
};

export async function sendVendorInviteEmail(input: InviteEmailInput): Promise<{
  sent: boolean;
  error?: string;
}> {
  const resend = getResend();
  if (!resend) {
    return {
      sent: false,
      error: "RESEND_API_KEY is not set. Vendor was created, but no email was sent.",
    };
  }

  const loginUrl = `${appBaseUrl()}/vendor/login`;
  const shopLabel = input.shop.replace(/\.myshopify\.com$/i, "");

  try {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: input.to,
      subject: `You're invited to sell on ${shopLabel}`,
      html: `
        <div style="font-family: system-ui, sans-serif; line-height: 1.5; color: #202223; max-width: 520px;">
          <h1 style="font-size: 20px;">Welcome, ${escapeHtml(input.vendorName)}</h1>
          <p>You have been invited to sell as a vendor on <strong>${escapeHtml(input.shop)}</strong>.</p>
          <p><strong>Login:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
          <p><strong>Email:</strong> ${escapeHtml(input.to)}<br/>
             <strong>Temporary password:</strong> ${escapeHtml(input.temporaryPassword)}</p>
          <p>Please change your password after you sign in (ask the store admin if you need a reset).</p>
          <p>Your account starts as <strong>pending</strong>. You can add products after the store admin approves you.</p>
          <p style="color:#6d7175;font-size:13px;">If you did not expect this email, you can ignore it.</p>
        </div>
      `,
      text: [
        `Welcome, ${input.vendorName}`,
        ``,
        `You have been invited to sell on ${input.shop}.`,
        `Login: ${loginUrl}`,
        `Email: ${input.to}`,
        `Temporary password: ${input.temporaryPassword}`,
        ``,
        `Your account starts as pending until the store admin approves you.`,
      ].join("\n"),
    });

    if (error) {
      return { sent: false, error: error.message };
    }
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Failed to send invite email.",
    };
  }
}

export async function sendVendorApprovedEmail(input: {
  to: string;
  vendorName: string;
  shop: string;
}): Promise<{ sent: boolean; error?: string }> {
  const resend = getResend();
  if (!resend) return { sent: false, error: "RESEND_API_KEY is not set." };

  const loginUrl = `${appBaseUrl()}/vendor/login`;
  const shopLabel = input.shop.replace(/\.myshopify\.com$/i, "");

  try {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: input.to,
      subject: `You're approved to sell on ${shopLabel}`,
      html: `
        <div style="font-family: system-ui, sans-serif; line-height: 1.5; color: #202223; max-width: 520px;">
          <h1 style="font-size: 20px;">You're approved, ${escapeHtml(input.vendorName)}</h1>
          <p>Your vendor account on <strong>${escapeHtml(input.shop)}</strong> is now approved.</p>
          <p>Sign in and start adding products:<br/><a href="${loginUrl}">${loginUrl}</a></p>
        </div>
      `,
      text: `You're approved on ${input.shop}. Login: ${loginUrl}`,
    });
    if (error) return { sent: false, error: error.message };
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Failed to send approval email.",
    };
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
