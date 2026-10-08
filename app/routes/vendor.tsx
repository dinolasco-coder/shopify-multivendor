import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
} from "react-router";
import { useEffect, useState } from "react";
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
  onNavigate,
}: {
  to: string;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={to}
      className={active ? "is-active" : undefined}
      onClick={onNavigate}
    >
      {label}
    </Link>
  );
}

export default function VendorLayout() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

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
  const closeMenu = () => setMenuOpen(false);

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
        <button
          type="button"
          className={`sx-backdrop${menuOpen ? " is-open" : ""}`}
          aria-label="Close menu"
          onClick={closeMenu}
        />
        <aside className={`sx-sidebar${menuOpen ? " is-open" : ""}`}>
          <div className="sx-brand">
            <div>
              <p className="sx-brand__name">Seller portal</p>
              <p className="sx-brand__sub">{data.shopLabel}</p>
            </div>
            <button
              type="button"
              className="sx-sidebar__close"
              aria-label="Close menu"
              onClick={closeMenu}
            >
              ×
            </button>
          </div>
          <nav className="sx-nav">
            <NavLink
              to="/vendor"
              label="Home"
              active={path === "/vendor"}
              onNavigate={closeMenu}
            />
            <NavLink
              to="/vendor/orders"
              label="Orders"
              active={path.startsWith("/vendor/orders")}
              onNavigate={closeMenu}
            />
            <NavLink
              to="/vendor/customized"
              label="Customized"
              active={path.startsWith("/vendor/customized")}
              onNavigate={closeMenu}
            />
            <NavLink
              to="/vendor/products"
              label="Products"
              active={path.startsWith("/vendor/products")}
              onNavigate={closeMenu}
            />
            <NavLink
              to="/vendor/inventory"
              label="Inventory"
              active={path.startsWith("/vendor/inventory")}
              onNavigate={closeMenu}
            />
            <NavLink
              to="/vendor/earnings"
              label="Payouts"
              active={path.startsWith("/vendor/earnings")}
              onNavigate={closeMenu}
            />
            <NavLink
              to="/vendor/sales"
              label="Sales"
              active={path.startsWith("/vendor/sales")}
              onNavigate={closeMenu}
            />
            <NavLink
              to="/vendor/reports"
              label="Analytics"
              active={path.startsWith("/vendor/reports")}
              onNavigate={closeMenu}
            />
            <div className="sx-nav__bottom">
              <Link to="/vendor/logout" onClick={closeMenu}>
                Log out
              </Link>
            </div>
          </nav>
        </aside>

        <div className="sx-main">
          <header className="sx-top">
            <div className="sx-top__user">
              <button
                type="button"
                className="sx-menu-btn"
                aria-label="Open menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
              >
                <span />
              </button>
              <div className="sx-avatar">{initial}</div>
              <div className="sx-top__meta">
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
