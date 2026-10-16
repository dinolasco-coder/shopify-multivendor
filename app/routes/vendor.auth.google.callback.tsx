import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  createVendor,
  getVendorByEmail,
  getVendorByGoogleId,
  updateVendor,
} from "../models/vendor.server";
import { getOrCreateSettings } from "../models/settings.server";
import { startVendorSession } from "../services/vendor-auth.server";
import { resolveVendorPortalShop } from "../services/portal-shop.server";
import {
  clearGoogleStateCookie,
  exchangeGoogleCode,
  isGoogleOAuthConfigured,
  readGoogleStateCookie,
  unusablePasswordHash,
} from "../services/google-oauth.server";

function failRedirect(message: string) {
  return redirect(
    `/vendor/login?error=${encodeURIComponent(message)}`,
    { headers: { "Set-Cookie": clearGoogleStateCookie() } },
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!isGoogleOAuthConfigured()) {
    throw failRedirect("Google sign-in is not configured.");
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    throw failRedirect("Google sign-in was cancelled.");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = readGoogleStateCookie(request);

  if (!code || !state || !cookieState || state !== cookieState) {
    throw failRedirect("Invalid Google sign-in state. Try again.");
  }

  const intent = state.endsWith(".register") ? "register" : "login";

  let profile;
  try {
    profile = await exchangeGoogleCode(code);
  } catch (e) {
    throw failRedirect(
      e instanceof Error ? e.message : "Google sign-in failed.",
    );
  }

  if (!profile.emailVerified) {
    throw failRedirect("Your Google email must be verified to continue.");
  }

  const portalShop = await resolveVendorPortalShop();
  if (!portalShop) {
    throw failRedirect("Vendor portal shop is not configured.");
  }

  let vendor =
    (await getVendorByGoogleId(portalShop, profile.sub)) ||
    (await getVendorByEmail(portalShop, profile.email));

  if (!vendor) {
    const settings = await getOrCreateSettings(portalShop);
    if (!settings.allowPublicRegistration && intent !== "login") {
      throw failRedirect(
        "Public seller registration is turned off. Ask the store admin for an invite.",
      );
    }
    if (!settings.allowPublicRegistration) {
      throw failRedirect(
        "No seller account found for this Google email. Ask the store admin for an invite.",
      );
    }

    vendor = await createVendor({
      shop: portalShop,
      name: profile.name,
      email: profile.email,
      passwordHash: unusablePasswordHash(),
      googleId: profile.sub,
      commissionPercent: settings.defaultCommissionPercent,
      commissionFlat: settings.defaultCommissionFlat ?? 0,
      status: "pending",
    });
  } else {
    if (!vendor.googleId) {
      await updateVendor(vendor.id, { googleId: profile.sub });
    } else if (vendor.googleId !== profile.sub) {
      throw failRedirect(
        "This email is linked to a different Google account.",
      );
    }
  }

  if (vendor.status === "suspended") {
    throw failRedirect(
      "This account is suspended. Contact the store admin for help.",
    );
  }

  const { cookie } = await startVendorSession(vendor.id);
  const dest = vendor.status === "approved" ? "/vendor" : "/vendor/pending";

  const headers = new Headers();
  headers.append("Set-Cookie", cookie);
  headers.append("Set-Cookie", clearGoogleStateCookie());

  return redirect(dest, { headers });
};
