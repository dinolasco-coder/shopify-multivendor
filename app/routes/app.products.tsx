import type { HeadersFunction } from "react-router";
import {
  Outlet,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export default function AdminProductsLayout() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    return (
      <s-page heading="Products">
        <div style={{ padding: 24, fontFamily: "Inter, sans-serif" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Products</h1>
          <p style={{ color: "#6d7175", marginBottom: 16 }}>
            The Products page was interrupted
            {error.status ? ` (status ${error.status})` : ""}. Open Products
            again from the sidebar, or refresh the app.
          </p>
          <a
            href="/app/products"
            style={{
              display: "inline-flex",
              padding: "10px 14px",
              borderRadius: 8,
              background: "#1a1a1a",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Reload Products
          </a>
        </div>
      </s-page>
    );
  }
  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
