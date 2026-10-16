import { createHash, randomBytes } from "crypto";
import { hashPassword } from "./password.server";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    (process.env.GOOGLE_CLIENT_ID || "").trim() &&
      (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
  );
}

export function googleRedirectUri(): string {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  if (!base) {
    throw new Error("SHOPIFY_APP_URL is required for Google sign-in.");
  }
  return `${base}/vendor/auth/google/callback`;
}

export function createGoogleOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function googleAuthUrl(state: string): string {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set.");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state,
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
};

export async function exchangeGoogleCode(code: string): Promise<GoogleProfile> {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured.");
  }

  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        "Google token exchange failed.",
    );
  }

  const profileRes = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const profile = (await profileRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    picture?: string;
  };
  if (!profileRes.ok || !profile.sub || !profile.email) {
    throw new Error("Could not load Google profile.");
  }

  return {
    sub: profile.sub,
    email: profile.email.toLowerCase(),
    emailVerified:
      profile.email_verified === true || profile.email_verified === "true",
    name: (profile.name || profile.email.split("@")[0] || "Seller").trim(),
    picture: profile.picture,
  };
}

/** Password hash that cannot be used for normal login. */
export function unusablePasswordHash(): string {
  return hashPassword(`google:${randomBytes(32).toString("hex")}`);
}

export function googleStateCookie(state: string, maxAgeSec = 600): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `vendor_google_oauth=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function clearGoogleStateCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `vendor_google_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readGoogleStateCookie(request: Request): string | null {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(/(?:^|;\s*)vendor_google_oauth=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function sha256Short(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
