import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { unauthenticated } from "../shopify.server";
import {
  getProductDetail,
  updateVendorProduct,
  deleteVendorProduct,
} from "../services/products.server";
import { fromProductPathId } from "../utils/product-id";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const pathId = params.productId;
  if (!pathId) throw redirect("/vendor/products");
  const productId = fromProductPathId(pathId);

  const { admin } = await unauthenticated.admin(vendor.shop);
  const product = await getProductDetail(admin, productId);

  if (!product || product.metafield?.value !== vendor.id) {
    throw new Response("Not found", { status: 404 });
  }

  return { product };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const pathId = params.productId;
  if (!pathId) return { error: "Missing product." };
  const productId = fromProductPathId(pathId);

  const form = await request.formData();
  const intent = String(form.get("intent") || "save");

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    const existing = await getProductDetail(admin, productId);
    if (!existing || existing.metafield?.value !== vendor.id) {
      return { error: "You can only edit your own products." };
    }

    if (intent === "delete") {
      await deleteVendorProduct(admin, productId);
      throw redirect("/vendor/products");
    }

    const title = String(form.get("title") || "").trim();
    const descriptionHtml = String(form.get("description") || "").trim();
    const price = String(form.get("price") || "").trim();
    const inventoryQuantity = Number(form.get("inventoryQuantity") || 0);
    const status = String(form.get("status") || "ACTIVE") as
      | "ACTIVE"
      | "DRAFT"
      | "ARCHIVED";

    if (!title || !price) {
      return { error: "Title and price are required." };
    }

    const variant = existing.variants?.nodes?.[0];
    await updateVendorProduct(admin, {
      productId,
      vendorId: vendor.id,
      title,
      descriptionHtml,
      price,
      status,
      variantId: variant?.id,
      inventoryItemId: variant?.inventoryItem?.id,
      inventoryQuantity: Number.isFinite(inventoryQuantity)
        ? Math.max(0, Math.floor(inventoryQuantity))
        : undefined,
    });

    // Reload list so stock column reflects the new quantity.
    throw redirect("/vendor/products");
  } catch (error) {
    if (error instanceof Response) throw error;
    return {
      error: error instanceof Error ? error.message : "Failed to update product.",
    };
  }
};

export default function EditVendorProduct() {
  const { product } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const variant = product.variants?.nodes?.[0];

  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.descriptionHtml || "");
  const [price, setPrice] = useState(variant?.price || "");
  const [inventoryQuantity, setInventoryQuantity] = useState(
    String(variant?.inventoryQuantity ?? 0),
  );
  const [status, setStatus] = useState(product.status || "ACTIVE");

  return (
    <Page
      title="Edit product"
      backAction={{ content: "Products", url: "/vendor/products" }}
    >
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}
        {actionData && "message" in actionData && actionData.message && (
          <Banner tone="success">{actionData.message}</Banner>
        )}
        <Card>
          <Form method="post">
            <input type="hidden" name="title" value={title} />
            <input type="hidden" name="description" value={description} />
            <input type="hidden" name="price" value={price} />
            <input
              type="hidden"
              name="inventoryQuantity"
              value={inventoryQuantity}
            />
            <input type="hidden" name="status" value={status} />
            <FormLayout>
              <TextField
                label="Title"
                value={title}
                onChange={setTitle}
                autoComplete="off"
              />
              <TextField
                label="Description"
                value={description}
                onChange={setDescription}
                multiline={4}
                autoComplete="off"
              />
              <FormLayout.Group>
                <TextField
                  label="Price"
                  type="number"
                  value={price}
                  onChange={setPrice}
                  autoComplete="off"
                />
                <TextField
                  label="Shop location quantity"
                  type="number"
                  value={inventoryQuantity}
                  onChange={setInventoryQuantity}
                  autoComplete="off"
                  helpText="Stock counted at your shop location for online orders."
                />
              </FormLayout.Group>
              <Select
                label="Status"
                options={[
                  { label: "Active", value: "ACTIVE" },
                  { label: "Draft", value: "DRAFT" },
                  { label: "Archived", value: "ARCHIVED" },
                ]}
                value={status}
                onChange={setStatus}
              />
              <Button submit variant="primary" loading={busy && navigation.formData?.get("intent") !== "delete"}>
                Save changes
              </Button>
            </FormLayout>
          </Form>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              Delete removes this product from your store permanently.
            </Text>
            <Form
              method="post"
              onSubmit={(event) => {
                if (
                  !confirm(
                    `Delete "${product.title}"? This cannot be undone.`,
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <Button
                submit
                tone="critical"
                loading={busy && navigation.formData?.get("intent") === "delete"}
                disabled={busy && navigation.formData?.get("intent") !== "delete"}
              >
                Delete product
              </Button>
            </Form>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
