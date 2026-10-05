import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { unauthenticated } from "../shopify.server";
import { createVendorProduct } from "../services/products.server";
import { getOrCreateSettings } from "../models/settings.server";
import { AddProductWizard } from "../components/AddProductWizard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const settings = await getOrCreateSettings(result.vendor.shop);
  return {
    requireProductApproval: settings.requireProductApproval,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

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

  const settings = await getOrCreateSettings(vendor.shop);
  const status = settings.requireProductApproval ? "DRAFT" : "ACTIVE";

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    await createVendorProduct(admin, {
      vendorId: vendor.id,
      vendorName: vendor.name,
      title,
      descriptionHtml,
      price,
      inventoryQuantity: Number.isFinite(inventoryQuantity)
        ? Math.max(0, inventoryQuantity)
        : 1,
      status,
      images,
    });
    return redirect("/vendor/products");
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
    };
  }
};

export default function VendorAddProduct() {
  const { requireProductApproval } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  return (
    <AddProductWizard
      requireProductApproval={requireProductApproval}
      error={
        actionData && "error" in actionData ? actionData.error : null
      }
      busy={navigation.state !== "idle"}
      backUrl="/vendor/products"
      backLabel="Back to my products"
    />
  );
}
