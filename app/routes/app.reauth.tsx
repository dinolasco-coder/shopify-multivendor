import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Clears the shop session then starts OAuth again so new SCOPES can be granted.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  await prisma.session.deleteMany({ where: { shop } });

  throw redirect(`/auth?shop=${encodeURIComponent(shop)}`);
};
