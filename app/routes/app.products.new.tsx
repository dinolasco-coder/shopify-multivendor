import type {
  ActionFunctionArgs,
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
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
import { getVendorById, listVendors } from "../models/vendor.server";
import { AddProductWizard } from "../components/AddProductWizard";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [vendors, settings] = await Promise.all([
    listVendors(session.shop),
    getOrCreateSettings(session.shop),
  ]);

  const sellers = vendors
    .filter((v) => v.status === "approved")
    .map((v) => ({ id: v.id, name: v.name }));

  return {
    sellers,
    requireProductApproval: settings.requireProductApproval,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  const vendorId = String(form.get("vendorId") || "").trim();
  const mode = String(form.get("mode") || "easy");
  const title = String(form.get("title") || "").trim();
  const descriptionHtml = String(form.get("description") || "").trim();
  const price = String(form.get("price") || "").trim();
  const inventoryQuantity = Number(form.get("inventoryQuantity") || 1);
  const images = form
    .getAll("media")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!vendorId) {
    return { error: "Please choose a seller for this product." };
  }

  const vendor = await getVendorById(vendorId);
  if (!vendor || vendor.shop !== session.shop) {
    return { error: "Seller not found." };
  }
  if (vendor.status !== "approved") {
    return { error: "Only approved sellers can receive products." };
  }

  if (mode !== "manual" && !images.length) {
    return { error: "Please add a photo of your product first." };
  }

  if (!title || !price || Number(price) < 0 || Number.isNaN(Number(price))) {
    return { error: "Please enter a name and a price." };
  }

  try {
    await createVendorProduct(admin, {
      vendorId: vendor.id,
      vendorName: vendor.name,
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
  const { sellers, requireProductApproval } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  return (
    <s-page heading="Add product">
      <AppProvider i18n={{}}>
        {sellers.length === 0 ? (
          <div style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
            <p style={{ fontSize: 15, color: "#6d7175" }}>
              No approved sellers yet. Invite and approve a seller first, then
              you can add products for them here.
            </p>
            <p style={{ marginTop: 12 }}>
              <a href="/app/vendors">Go to Sellers</a>
            </p>
          </div>
        ) : (
          <AddProductWizard
            requireProductApproval={requireProductApproval}
            error={
              actionData && "error" in actionData ? actionData.error : null
            }
            busy={navigation.state !== "idle"}
            backUrl="/app/products"
            backLabel="Back to products"
            sellers={sellers}
          />
        )}
      </AppProvider>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
