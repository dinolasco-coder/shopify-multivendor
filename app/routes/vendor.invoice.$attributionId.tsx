import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import prisma from "../db.server";
import { formatMoney } from "../utils/money";

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
  }>;

  return {
    vendorName: vendor.name,
    vendorEmail: vendor.email,
    attribution,
    items,
  };
};

export default function VendorInvoice() {
  const { vendorName, vendorEmail, attribution, items } =
    useLoaderData<typeof loader>();
  const sellerNet =
    attribution.subtotal - attribution.commissionAmount;

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
          th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #ddd; }
          th { font-size: 13px; color: #555; }
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
                <td>{item.title}</td>
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
