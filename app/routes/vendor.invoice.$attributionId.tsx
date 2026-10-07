import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { ReactNode } from "react";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import prisma from "../db.server";
import { formatMoney } from "../utils/money";
import { unauthenticated } from "../shopify.server";

function findUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'\)\]|]+/gi) || [];
  return found.map((raw) => raw.replace(/[.,;:!?]+$/g, ""));
}

function isImageUrl(url: string) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path);
  } catch {
    return false;
  }
}

function linkifyNote(note: string) {
  const urls = findUrls(note);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  urls.forEach((url, i) => {
    const at = note.indexOf(url, cursor);
    if (at === -1) return;
    if (at > cursor) {
      nodes.push(<span key={`t-${i}`}>{note.slice(cursor, at)}</span>);
    }
    nodes.push(
      <a
        key={`u-${i}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "#2c6ecb",
          textDecoration: "underline",
          wordBreak: "break-all",
        }}
      >
        {url}
      </a>,
    );
    cursor = at + url.length;
  });
  if (cursor < note.length) {
    nodes.push(<span key="tail">{note.slice(cursor)}</span>);
  }
  return nodes;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const attributionId = params.attributionId;
  if (!attributionId) {
    throw new Response("Not found", { status: 404 });
  }

  const attribution = await prisma.orderAttribution.findUnique({
    where: { id: attributionId },
  });
  if (!attribution || attribution.vendorId !== vendor.id) {
    throw new Response("Not found", { status: 404 });
  }

  const items = JSON.parse(attribution.lineItemsJson || "[]") as Array<{
    title: string;
    quantity: number;
    price: number;
    imageUrl?: string | null;
  }>;

  let note: string | null = null;
  let details: Array<{ key: string; value: string }> = [];
  let customerName = "";
  let customerPhone: string | null = null;
  let customerAddress = "";
  try {
    const { admin } = await unauthenticated.admin(vendor.shop);
    const response = await admin.graphql(
      `#graphql
      query vendorInvoiceOrder($id: ID!) {
        order(id: $id) {
          note
          customAttributes { key value }
          shippingAddress {
            name
            phone
            company
            address1
            address2
            city
            province
            zip
            country
          }
        }
      }`,
      { variables: { id: attribution.shopifyOrderId } },
    );
    const json = await response.json();
    const order = json.data?.order;
    if (order?.note) note = String(order.note);
    details = (
      (order?.customAttributes ?? []) as Array<{
        key?: string;
        value?: string;
      }>
    )
      .filter((a) => a.key && a.value)
      .map((a) => ({ key: String(a.key), value: String(a.value) }));
    const ship = order?.shippingAddress;
    if (ship) {
      customerName = String(ship.name || "");
      customerPhone = ship.phone ? String(ship.phone) : null;
      const cityLine = [ship.city, ship.province, ship.zip]
        .filter(Boolean)
        .join(", ");
      customerAddress = [
        ship.company,
        ship.address1,
        ship.address2,
        cityLine,
        ship.country,
      ]
        .filter(Boolean)
        .join("\n");
    }
  } catch (error) {
    console.error("Failed loading order notes for invoice", error);
  }

  return {
    vendorName: vendor.name,
    vendorEmail: vendor.email,
    attribution,
    items,
    note,
    details,
    customerName,
    customerPhone,
    customerAddress,
  };
};

export default function VendorInvoice() {
  const {
    vendorName,
    vendorEmail,
    attribution,
    items,
    note,
    details,
    customerName,
    customerPhone,
    customerAddress,
  } = useLoaderData<typeof loader>();
  const sellerNet = attribution.subtotal - attribution.commissionAmount;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>
          Invoice {attribution.shopifyOrderName || attribution.shopifyOrderId}
        </title>
        <style>{`
          body { font-family: Georgia, "Times New Roman", serif; color: #111; margin: 40px; }
          h1 { font-size: 28px; margin: 0 0 8px; }
          .muted { color: #555; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #ddd; vertical-align: middle; }
          th { font-size: 13px; color: #555; }
          .item { display: flex; align-items: center; gap: 12px; }
          .thumb { width: 48px; height: 48px; border-radius: 6px; object-fit: cover; border: 1px solid #ddd; background: #f3f3f3; }
          .notes { margin-top: 20px; padding: 12px 14px; background: #f6f6f7; border-radius: 8px; white-space: pre-wrap; word-break: break-word; }
          .totals { margin-top: 20px; max-width: 320px; margin-left: auto; }
          .totals div { display: flex; justify-content: space-between; padding: 6px 0; }
          .actions { margin-top: 28px; }
          @media print { .actions { display: none; } body { margin: 16px; } }
        `}</style>
      </head>
      <body>
        <h1>Seller invoice</h1>
        <p className="muted">
          {vendorName} · {vendorEmail}
        </p>
        <p>
          <strong>Order:</strong>{" "}
          {attribution.shopifyOrderName || attribution.shopifyOrderId}
          <br />
          <strong>Date:</strong>{" "}
          {new Date(attribution.createdAt).toLocaleString()}
        </p>

        {(customerName || customerAddress) && (
          <p>
            <strong>Ship to:</strong>
            <br />
            {customerName || "Guest"}
            {customerPhone ? (
              <>
                <br />
                {customerPhone}
              </>
            ) : null}
            {customerAddress ? (
              <>
                <br />
                <span style={{ whiteSpace: "pre-line" }}>{customerAddress}</span>
              </>
            ) : null}
          </p>
        )}

        {(note || details.length > 0) && (
          <div className="notes">
            {note ? (
              <div style={{ margin: "0 0 8px" }}>
                <p style={{ margin: 0 }}>
                  <strong>Notes:</strong> {linkifyNote(note)}
                </p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {(findUrls(note) || [])
                    .filter(isImageUrl)
                    .map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={url}
                          alt="Custom design"
                          style={{
                            width: 120,
                            height: 120,
                            objectFit: "cover",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                          }}
                        />
                      </a>
                    ))}
                </div>
              </div>
            ) : null}
            {details.length > 0 ? (
              <div>
                <strong>Additional details</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {details.map((d) => (
                    <li key={d.key}>
                      {d.key}: {d.value}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Line</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index}>
                <td>
                  <div className="item">
                    {item.imageUrl ? (
                      <img className="thumb" src={item.imageUrl} alt="" />
                    ) : (
                      <div className="thumb" />
                    )}
                    <span>{item.title}</span>
                  </div>
                </td>
                <td>{item.quantity}</td>
                <td>{formatMoney(item.price, attribution.currency)}</td>
                <td>
                  {formatMoney(item.price * item.quantity, attribution.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="totals">
          <div>
            <span>Subtotal</span>
            <strong>
              {formatMoney(attribution.subtotal, attribution.currency)}
            </strong>
          </div>
          <div>
            <span>Platform commission</span>
            <strong>
              {formatMoney(attribution.commissionAmount, attribution.currency)}
            </strong>
          </div>
          <div>
            <span>Your net</span>
            <strong>{formatMoney(sellerNet, attribution.currency)}</strong>
          </div>
        </div>

        <div className="actions">
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </body>
    </html>
  );
}
