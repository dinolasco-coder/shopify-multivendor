import { Outlet } from "react-router";

/** Layout so /app/products and /app/products/new both live under Products. */
export default function ProductsLayout() {
  return <Outlet />;
}
