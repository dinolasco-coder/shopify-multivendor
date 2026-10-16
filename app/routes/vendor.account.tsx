import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import {
  getVendorByEmail,
  updateVendor,
} from "../models/vendor.server";
import { hashPassword, verifyPassword } from "../services/password.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const v = result.vendor;
  return {
    name: v.name,
    email: v.email,
    hasGoogle: Boolean(v.googleId),
    hasPasswordLogin: Boolean(v.passwordHash),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "updateProfile") {
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!name || !email) {
      return { error: "Name and email are required." };
    }
    if (email !== result.vendor.email) {
      const taken = await getVendorByEmail(result.vendor.shop, email);
      if (taken && taken.id !== result.vendor.id) {
        return { error: "That email is already used by another seller." };
      }
    }
    await updateVendor(result.vendor.id, { name, email });
    return { ok: true, message: "Profile saved." };
  }

  if (intent === "changePassword") {
    const current = String(form.get("currentPassword") || "");
    const next = String(form.get("newPassword") || "");
    const confirm = String(form.get("confirmPassword") || "");

    if (next.length < 8) {
      return { error: "New password must be at least 8 characters." };
    }
    if (next !== confirm) {
      return { error: "New password and confirmation do not match." };
    }

    // Google-only accounts can set a password without a current one.
    if (result.vendor.googleId && !current) {
      await updateVendor(result.vendor.id, {
        passwordHash: hashPassword(next),
      });
      return { ok: true, message: "Password set. You can also log in with email." };
    }

    if (!verifyPassword(current, result.vendor.passwordHash)) {
      return { error: "Current password is incorrect." };
    }

    await updateVendor(result.vendor.id, {
      passwordHash: hashPassword(next),
    });
    return { ok: true, message: "Password updated." };
  }

  return { error: "Unknown action." };
};

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid #c9cccf",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
};

const labelStyle = {
  display: "block" as const,
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
};

export default function VendorAccount() {
  const { name, email, hasGoogle } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div>
      <h1 className="sx-title">Account</h1>
      <p className="sx-sub">
        Manage your seller profile and password.
        {hasGoogle ? " This account is linked to Google." : ""}
      </p>

      {actionData && "error" in actionData && actionData.error ? (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "#fbeae9",
            color: "#8e1f0b",
            fontSize: 13,
          }}
        >
          {actionData.error}
        </div>
      ) : null}
      {actionData && "message" in actionData && actionData.message ? (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "#e4f7e9",
            color: "#0d6b2d",
            fontSize: 13,
          }}
        >
          {actionData.message}
        </div>
      ) : null}

      <div className="sx-panel" style={{ marginBottom: 16 }}>
        <h2 className="sx-panel__title">Profile</h2>
        <Form method="post">
          <input type="hidden" name="intent" value="updateProfile" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <label style={labelStyle}>Business name</label>
              <input
                name="name"
                defaultValue={name}
                required
                style={fieldStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                name="email"
                type="email"
                defaultValue={email}
                required
                style={fieldStyle}
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="sx-btn sx-btn--primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save profile"}
            </button>
          </div>
        </Form>
      </div>

      <div className="sx-panel">
        <h2 className="sx-panel__title">Password</h2>
        <p className="sx-sub" style={{ marginTop: 0 }}>
          {hasGoogle
            ? "Optional — set a password to also log in with email."
            : "Change the password you use to log in."}
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="changePassword" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            {!hasGoogle ? (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Current password</label>
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  style={fieldStyle}
                />
              </div>
            ) : (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>
                  Current password (only if you already set one)
                </label>
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  style={fieldStyle}
                />
              </div>
            )}
            <div>
              <label style={labelStyle}>New password</label>
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                style={fieldStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Confirm new password</label>
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                style={fieldStyle}
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="sx-btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : hasGoogle ? "Set password" : "Update password"}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
