import type {
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { AppProvider } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createVendorProduct } from "../services/products.server";
import { getOrCreateSettings } from "../models/settings.server";
import { ADMIN_STORE_VENDOR_ID } from "../constants";
import { AddProductWizard } from "../components/AddProductWizard";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getOrCreateSettings(session.shop);
  const shopLabel = session.shop.replace(/\.myshopify\.com$/i, "");

  return {
    requireProductApproval: settings.requireProductApproval,
    shopLabel,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  const mode = String(form.get("mode") || "easy");
  const title = String(form.get("title") || "").trim();
  const descriptionHtml = String(form.get("description") || "").trim();
  const price = String(form.get("price") || "").trim();
  const inventoryQuantity = Number(form.get("inventoryQuantity") || 1);
  const images = form
    .getAll("media")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (mode !== "manual" && !images.length) {
    return { error: "Please add a photo of your product first." };
  }

  if (!title || !price || Number(price) < 0 || Number.isNaN(Number(price))) {
    return { error: "Please enter a name and a price." };
  }

  const shopLabel = session.shop.replace(/\.myshopify\.com$/i, "");

  try {
    await createVendorProduct(admin, {
      vendorId: ADMIN_STORE_VENDOR_ID,
      vendorName: shopLabel,
      title,
      descriptionHtml,
      price,
      inventoryQuantity: Number.isFinite(inventoryQuantity)
        ? Math.max(0, inventoryQuantity)
        : 1,
      status: "ACTIVE",
      images,
    });
    return redirect("/app/products");
  } catch (error) {
    console.error("Admin create product failed", session.shop, error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
    };
  }
};

export default function AdminAddProductPage() {
  const { requireProductApproval } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  return (
    <s-page heading="Add product">
      <AppProvider i18n={{}}>
        <AddProductWizard
          requireProductApproval={requireProductApproval}
          error={actionData && "error" in actionData ? actionData.error : null}
          busy={navigation.state !== "idle"}
          backUrl="/app/products"
          backLabel="Back to products"
        />
      </AppProvider>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
