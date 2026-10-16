import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  createGoogleOAuthState,
  googleAuthUrl,
  googleStateCookie,
  isGoogleOAuthConfigured,
} from "../services/google-oauth.server";

/** Start Google OAuth for seller login / register. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!isGoogleOAuthConfigured()) {
    throw redirect(
      "/vendor/login?error=" +
        encodeURIComponent(
          "Google sign-in is not configured. Ask the admin to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        ),
    );
  }

  const url = new URL(request.url);
  const intent = url.searchParams.get("intent") === "register" ? "register" : "login";
  const state = `${createGoogleOAuthState()}.${intent}`;

  return redirect(googleAuthUrl(state), {
    headers: { "Set-Cookie": googleStateCookie(state) },
  });
};
