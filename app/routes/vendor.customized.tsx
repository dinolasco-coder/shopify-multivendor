import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { listAttributionsForVendor } from "../models/attribution.server";
import { unauthenticated } from "../shopify.server";
import { findImageUrls } from "../utils/note-links";

type CustomDesign = {
  attributionId: string;
  orderName: string;
  orderId: string;
  createdAt: string;
  productTitle: string;
  note: string;
  imageUrls: string[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const { vendor } = result;

  const attributions = await listAttributionsForVendor(vendor.id);
  const designs: CustomDesign[] = [];

  try {
    const { admin } = await unauthenticated.admin(vendor.shop);

    await Promise.all(
      attributions.slice(0, 40).map(async (attr) => {
        try {
          const response = await admin.graphql(
            `#graphql
            query vendorCustomNote($id: ID!) {
              order(id: $id) {
                id
                name
                note
              }
            }`,
            { variables: { id: attr.shopifyOrderId } },
          );
          const json = await response.json();
          const order = json.data?.order;
          const note = order?.note ? String(order.note) : "";
          const imageUrls = findImageUrls(note);
          if (!imageUrls.length) return;

          let productTitle = "Product";
          try {
            const items = JSON.parse(attr.lineItemsJson || "[]") as Array<{
              title?: string;
            }>;
            productTitle = items[0]?.title || productTitle;
          } catch {
            /* ignore */
          }

          designs.push({
            attributionId: attr.id,
            orderName: attr.shopifyOrderName || order?.name || attr.shopifyOrderId,
            orderId: attr.shopifyOrderId,
            createdAt: new Date(attr.createdAt).toISOString(),
            productTitle,
            note,
            imageUrls,
          });
        } catch (error) {
          console.error("customized note fetch failed", attr.id, error);
        }
      }),
    );
  } catch (error) {
    console.error("Failed loading customized designs", error);
  }

  designs.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return { designs };
};

export default function VendorCustomized() {
  const { designs } = useLoaderData<typeof loader>();

  return (
    <div>
      <h1 className="sx-title">Customized</h1>
      <p className="sx-sub">
        Custom design images from your order notes. Tap a design to open it.
      </p>

      {designs.length === 0 ? (
        <div className="sx-panel">
          <p className="sx-secondary" style={{ margin: 0 }}>
            No custom design images yet. When a customer order has a design
            link in the notes, it will show up here.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {designs.map((d) => (
            <div
              key={d.attributionId}
              className="sx-panel"
              style={{ marginBottom: 0, padding: 14 }}
            >
              <p className="sx-primary" style={{ margin: "0 0 4px" }}>
                {d.orderName}
              </p>
              <p className="sx-secondary" style={{ margin: "0 0 10px" }}>
                {d.productTitle} ·{" "}
                {new Date(d.createdAt).toLocaleDateString()}
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {d.imageUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "block",
                      textDecoration: "none",
                      color: "inherit",
                    }}
                  >
                    <img
                      src={url}
                      alt={`Custom design for ${d.orderName}`}
                      style={{
                        width: "100%",
                        aspectRatio: "1",
                        objectFit: "cover",
                        borderRadius: 10,
                        border: "1px solid #e4e5e7",
                        background: "#fff",
                        display: "block",
                      }}
                    />
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: 8,
                        color: "#2c6ecb",
                        fontWeight: 700,
                        fontSize: 13,
                        textDecoration: "underline",
                      }}
                    >
                      Open design
                    </span>
                  </a>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <Link
                  className="sx-btn"
                  to={`/vendor/orders`}
                  style={{ fontSize: 13 }}
                >
                  View in Orders
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
