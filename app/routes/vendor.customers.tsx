import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useMemo, useState } from "react";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { listAttributionsForVendor } from "../models/attribution.server";
import { unauthenticated } from "../shopify.server";
import { formatMoney } from "../utils/money";

type CustomerRow = {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  orderCount: number;
  totalSpent: number;
  currency: string;
  lastOrderAt: string;
  lastOrderName: string | null;
};

function formatLocation(shipping: {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
} | null): string | null {
  if (!shipping) return null;
  const cityLine = [shipping.city, shipping.province, shipping.zip]
    .filter(Boolean)
    .join(", ");
  const parts = [
    shipping.address1,
    shipping.address2,
    cityLine,
    shipping.country,
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

async function fetchCustomerBits(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  orderIds: string[],
) {
  const unique = [...new Set(orderIds)].slice(0, 80);
  const map: Record<
    string,
    {
      email: string | null;
      phone: string | null;
      name: string;
      location: string | null;
    }
  > = {};

  await Promise.all(
    unique.map(async (id) => {
      try {
        const response = await admin.graphql(
          `#graphql
          query vendorCustomerFromOrder($id: ID!) {
            order(id: $id) {
              email
              phone
              shippingAddress {
                name
                phone
                address1
                address2
                city
                province
                zip
                country
              }
            }
          }`,
          { variables: { id } },
        );
        const json = await response.json();
        const order = json.data?.order;
        if (!order) return;
        const shipping = order.shippingAddress;
        const phone =
          (shipping?.phone ? String(shipping.phone) : null) ||
          (order.phone ? String(order.phone) : null);
        map[id] = {
          email: order.email ? String(order.email).trim().toLowerCase() : null,
          phone,
          name: String(shipping?.name || "").trim() || "Guest",
          location: formatLocation(
            shipping
              ? {
                  address1: shipping.address1,
                  address2: shipping.address2,
                  city: shipping.city,
                  province: shipping.province,
                  zip: shipping.zip,
                  country: shipping.country,
                }
              : null,
          ),
        };
      } catch (error) {
        console.error("vendor customer fetch failed", id, error);
      }
    }),
  );

  return map;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const attributions = await listAttributionsForVendor(vendor.id);
  const { admin } = await unauthenticated.admin(vendor.shop);
  const orderIds = attributions.map((a) => a.shopifyOrderId);
  const bits = await fetchCustomerBits(admin, orderIds);

  const byKey = new Map<
    string,
    {
      name: string;
      email: string | null;
      phone: string | null;
      location: string | null;
      orderIds: Set<string>;
      totalSpent: number;
      currency: string;
      lastOrderAt: Date;
      lastOrderName: string | null;
    }
  >();

  for (const row of attributions) {
    const info = bits[row.shopifyOrderId];
    const email = info?.email || null;
    const phone = info?.phone || null;
    const name = info?.name || "Guest";
    const key =
      email ||
      phone ||
      `${name.toLowerCase()}|${row.shopifyOrderId}`;

    const existing = byKey.get(key);
    const createdAt = new Date(row.createdAt);
    if (!existing) {
      byKey.set(key, {
        name,
        email,
        phone,
        location: info?.location || null,
        orderIds: new Set([row.shopifyOrderId]),
        totalSpent: row.subtotal,
        currency: row.currency,
        lastOrderAt: createdAt,
        lastOrderName: row.shopifyOrderName,
      });
      continue;
    }

    existing.orderIds.add(row.shopifyOrderId);
    existing.totalSpent += row.subtotal;
    if (!existing.email && email) existing.email = email;
    if (!existing.phone && phone) existing.phone = phone;
    if ((!existing.location || existing.location === "") && info?.location) {
      existing.location = info.location;
    }
    if (name !== "Guest") existing.name = name;
    if (createdAt > existing.lastOrderAt) {
      existing.lastOrderAt = createdAt;
      existing.lastOrderName = row.shopifyOrderName;
    }
  }

  const customers: CustomerRow[] = [...byKey.entries()]
    .map(([key, c]) => ({
      key,
      name: c.name,
      email: c.email,
      phone: c.phone,
      location: c.location,
      orderCount: c.orderIds.size,
      totalSpent: Math.round(c.totalSpent * 100) / 100,
      currency: c.currency,
      lastOrderAt: c.lastOrderAt.toISOString(),
      lastOrderName: c.lastOrderName,
    }))
    .sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));

  return {
    customers,
    totalCustomers: customers.length,
  };
};

export default function VendorCustomers() {
  const { customers, totalCustomers } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email && c.email.includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.location && c.location.toLowerCase().includes(q)) ||
        (c.lastOrderName && c.lastOrderName.toLowerCase().includes(q))
      );
    });
  }, [customers, query]);

  return (
    <div>
      <div className="sx-page-head">
        <div>
          <h1 className="sx-title">Customers</h1>
          <p className="sx-sub">
            People who bought your products (from your attributed orders)
          </p>
        </div>
        <Link className="sx-btn" to="/vendor/orders">
          View orders
        </Link>
      </div>

      <div className="sx-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px" }}>
          <div className="sx-search">
            <span aria-hidden>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, phone, or location"
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="sx-empty">
            {totalCustomers === 0
              ? "No customers yet. When someone buys your products, they show up here."
              : "No customers match your search."}
          </div>
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th>Orders</th>
                  <th>Spent with you</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <p className="sx-primary">{c.name}</p>
                    </td>
                    <td>
                      {c.email ? (
                        <p className="sx-primary" style={{ fontWeight: 600 }}>
                          {c.email}
                        </p>
                      ) : (
                        <p className="sx-secondary">No email</p>
                      )}
                      {c.phone ? (
                        <p className="sx-secondary">{c.phone}</p>
                      ) : null}
                    </td>
                    <td>
                      {c.location ? (
                        <p
                          className="sx-secondary"
                          style={{ whiteSpace: "pre-line", maxWidth: 260 }}
                        >
                          {c.location}
                        </p>
                      ) : (
                        <p className="sx-secondary">—</p>
                      )}
                    </td>
                    <td>
                      <span className="sx-stock sx-stock--ok">
                        {c.orderCount}
                      </span>
                    </td>
                    <td>{formatMoney(c.totalSpent, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
