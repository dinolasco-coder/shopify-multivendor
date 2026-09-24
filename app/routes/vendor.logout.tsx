import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { endVendorSession } from "../services/vendor-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const cookie = await endVendorSession(request);
  return redirect("/vendor/login", {
    headers: { "Set-Cookie": cookie },
  });
};
