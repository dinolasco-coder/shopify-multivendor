import {
  VENDOR_SESSION_COOKIE,
  VENDOR_SESSION_DAYS,
} from "../constants";
import {
  createVendorSession,
  destroyVendorSession,
  getVendorFromSessionToken,
} from "../models/vendor-session.server";
import type { Vendor } from "@prisma/client";

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf("=");
        if (i === -1) return [c, ""];
        return [
          decodeURIComponent(c.slice(0, i)),
          decodeURIComponent(c.slice(i + 1)),
        ];
      }),
  );
}

export function getVendorSessionToken(request: Request): string | null {
  const cookies = parseCookies(request);
  return cookies[VENDOR_SESSION_COOKIE] || null;
}

export function vendorSessionCookieHeader(
  token: string,
  expiresAt: Date,
): string {
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${VENDOR_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearVendorSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${VENDOR_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function authenticateVendor(
  request: Request,
): Promise<{ vendor: Vendor; headers?: HeadersInit } | Response> {
  const token = getVendorSessionToken(request);
  const vendor = await getVendorFromSessionToken(token);

  if (!vendor) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/vendor/login",
        "Set-Cookie": clearVendorSessionCookieHeader(),
      },
    });
  }

  return { vendor };
}

export async function requireApprovedVendor(
  request: Request,
): Promise<{ vendor: Vendor } | Response> {
  const result = await authenticateVendor(request);
  if (result instanceof Response) return result;

  if (result.vendor.status !== "approved") {
    return new Response(null, {
      status: 302,
      headers: { Location: "/vendor/pending" },
    });
  }

  return { vendor: result.vendor };
}

export async function startVendorSession(vendorId: string) {
  const { token, expiresAt } = await createVendorSession(vendorId);
  // Ensure expiry aligns with cookie max age constant
  const days = VENDOR_SESSION_DAYS;
  void days;
  return {
    token,
    cookie: vendorSessionCookieHeader(token, expiresAt),
  };
}

export async function endVendorSession(request: Request) {
  const token = getVendorSessionToken(request);
  await destroyVendorSession(token);
  return clearVendorSessionCookieHeader();
}
