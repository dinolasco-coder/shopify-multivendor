import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useLocation } from "react-router";
import { AppProvider, Badge, Frame, InlineStack, Navigation, Text, TopBar } from "@shopify/polaris";
import {
  HomeIcon,
  OrderIcon,
  ProductIcon,
  CashDollarIcon,
  ChartVerticalFilledIcon,
  ExitIcon,
} from "@shopify/polaris-icons";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import {
  authenticateVendor,
  endVendorSession,
} from "../services/vendor-auth.server";
import { resolveVendorPortalShop } from "../services/portal-shop.server";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const path = url.pathname;

  if (
    path === "/vendor/login" ||
    path === "/vendor/register" ||
    path.startsWith("/vendor/login") ||
    path.startsWith("/vendor/register") ||
    path.startsWith("/vendor/u/")
  ) {
    return { vendor: null, publicRoute: true };
  }

  const result = await authenticateVendor(request);
  if (result instanceof Response) {
    throw result;
  }

  const portalShop = await resolveVendorPortalShop();
  if (portalShop && result.vendor.shop !== portalShop) {
    const clearCookie = await endVendorSession(request);
    throw redirect("/vendor/login", {
      headers: { "Set-Cookie": clearCookie },
    });
  }

  if (
    result.vendor.status !== "approved" &&
    !path.startsWith("/vendor/pending") &&
    !path.startsWith("/vendor/logout")
  ) {
    throw redirect("/vendor/pending");
  }

  return { vendor: result.vendor, publicRoute: false };
};

export default function VendorLayout() {
  const { vendor, publicRoute } = useLoaderData<typeof loader>();
  const location = useLocation();

  if (publicRoute || !vendor) {
    return (
      <AppProvider i18n={{}}>
        <Outlet />
      </AppProvider>
    );
  }

  // Printable invoices: no portal chrome
  if (location.pathname.startsWith("/vendor/invoice")) {
    return (
      <AppProvider i18n={{}}>
        <Outlet />
      </AppProvider>
    );
  }

  const statusTone =
    vendor.status === "approved"
      ? "success"
      : vendor.status === "pending"
        ? "attention"
        : "critical";

  const navigationMarkup = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        title="Vendor portal"
        items={[
          {
            url: "/vendor",
            label: "Home",
            icon: HomeIcon,
            exactMatch: true,
          },
          ...(vendor.status === "approved"
            ? [
                {
                  url: "/vendor/products",
                  label: "Products",
                  icon: ProductIcon,
                },
                {
                  url: "/vendor/orders",
                  label: "Orders",
                  icon: OrderIcon,
                },
                {
                  url: "/vendor/sales",
                  label: "Sales",
                  icon: ChartVerticalFilledIcon,
                },
                {
                  url: "/vendor/earnings",
                  label: "Earnings",
                  icon: CashDollarIcon,
                },
              ]
            : []),
        ]}
      />
      <Navigation.Section
        items={[
          {
            url: "/vendor/logout",
            label: "Log out",
            icon: ExitIcon,
          },
        ]}
      />
    </Navigation>
  );

  return (
    <AppProvider i18n={{}}>
      <Frame topBar={<TopBar showNavigationToggle />} navigation={navigationMarkup}>
        <div style={{ padding: "16px 16px 0" }}>
          <InlineStack align="space-between" blockAlign="center" wrap>
            <Text as="p" variant="bodySm" tone="subdued">
              Signed in as {vendor.name} ({vendor.email})
            </Text>
            <Badge tone={statusTone}>{vendor.status}</Badge>
          </InlineStack>
        </div>
        <Outlet />
      </Frame>
    </AppProvider>
  );
}
