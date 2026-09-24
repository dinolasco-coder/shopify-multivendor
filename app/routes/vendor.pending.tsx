import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Banner, BlockStack, Card, Page, Text } from "@shopify/polaris";
import { authenticateVendor } from "../services/vendor-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await authenticateVendor(request);
  if (result instanceof Response) throw result;
  return { vendor: result.vendor };
};

export default function VendorPending() {
  const { vendor } = useLoaderData<typeof loader>();

  const tone =
    vendor.status === "approved"
      ? "success"
      : vendor.status === "pending"
        ? "info"
        : "critical";

  return (
    <Page title="Account status">
      <Card>
        <BlockStack gap="300">
          <Banner tone={tone}>
            <p>
              Thanks, <strong>{vendor.name}</strong>. Your account is{" "}
              <strong>{vendor.status}</strong>.
            </p>
          </Banner>
          {vendor.status === "pending" && (
            <Text as="p">
              The store admin will review your application. Once approved, you
              can add products and manage inventory from this portal.
            </Text>
          )}
          {vendor.status === "rejected" && (
            <Text as="p">
              Your application was not approved. Contact the store admin if you
              believe this is a mistake.
            </Text>
          )}
          {vendor.status === "suspended" && (
            <Text as="p">
              Your vendor account is suspended. Contact the store admin for next
              steps.
            </Text>
          )}
          {vendor.status === "approved" && (
            <Text as="p">
              You are approved. <a href="/vendor">Go to your dashboard</a>.
            </Text>
          )}
        </BlockStack>
      </Card>
    </Page>
  );
}
