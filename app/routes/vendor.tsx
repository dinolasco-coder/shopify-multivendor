import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, redirect, useLoaderData, useLocation } from "react-router";
import { AppProvider } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import {
  authenticateVendor,
  endVendorSession,
} from "../services/vendor-auth.server";
import { resolveVendorPortalShop } from "../services/portal-shop.server";
import { vendorPortalStyles } from "../styles/vendor-portal";

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

  return {
    vendor: result.vendor,
    publicRoute: false,
    shopLabel: result.vendor.shop.replace(/\.myshopify\.com$/i, ""),
  };
};

function NavLink({
  to,
  label,
  active,
}: {
  to: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link to={to} className={active ? "is-active" : undefined}>
      {label}
    </Link>
  );
}

export default function VendorLayout() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();

  if (data.publicRoute || !data.vendor) {
    return (
      <AppProvider i18n={{}}>
        <Outlet />
      </AppProvider>
    );
  }

  if (location.pathname.startsWith("/vendor/invoice")) {
    return (
      <AppProvider i18n={{}}>
        <Outlet />
      </AppProvider>
    );
  }

  // Pending sellers keep a simple shell
  if (data.vendor.status !== "approved") {
    return (
      <AppProvider i18n={{}}>
        <Outlet />
      </AppProvider>
    );
  }

  const vendor = data.vendor;
  const path = location.pathname;
  const initial = (vendor.name || "?").charAt(0).toUpperCase();
  const statusClass =
    vendor.status === "approved"
      ? "ok"
      : vendor.status === "pending"
        ? "warn"
        : "bad";

  return (
    <AppProvider i18n={{}}>
      <style
        dangerouslySetInnerHTML={{
          __html: `${vendorPortalStyles}
            html, body { margin: 0; background: #f6f6f7; }
          `,
        }}
      />
      <div className="sx-shell">
        <aside className="sx-sidebar">
          <div className="sx-brand">
            <p className="sx-brand__name">Seller portal</p>
            <p className="sx-brand__sub">{data.shopLabel}</p>
          </div>
          <nav className="sx-nav">
            <NavLink to="/vendor" label="Home" active={path === "/vendor"} />
            <NavLink
              to="/vendor/orders"
              label="Orders"
              active={path.startsWith("/vendor/orders")}
            />
            <NavLink
              to="/vendor/products"
              label="Products"
              active={path.startsWith("/vendor/products")}
            />
            <NavLink
              to="/vendor/earnings"
              label="Payouts"
              active={path.startsWith("/vendor/earnings")}
            />
            <NavLink
              to="/vendor/sales"
              label="Sales"
              active={path.startsWith("/vendor/sales")}
            />
            <div className="sx-nav__bottom">
              <Link to="/vendor/logout">Log out</Link>
            </div>
          </nav>
        </aside>

        <div className="sx-main">
          <header className="sx-top">
            <div className="sx-top__user">
              <div className="sx-avatar">{initial}</div>
              <div>
                <p className="sx-top__name">{vendor.name}</p>
                <p className="sx-top__email">{vendor.email}</p>
              </div>
            </div>
            <span className={`sx-badge ${statusClass}`}>{vendor.status}</span>
          </header>
          <div className="sx-content">
            <Outlet />
          </div>
        </div>
      </div>
    </AppProvider>
  );
}
