import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listAttributionsForShop } from "../models/attribution.server";
import {
  listCustomizationRequestsForShop,
} from "../models/customization.server";
import { syncCustomizationForAttribution } from "../services/customization-sync.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const attributions = await listAttributionsForShop(session.shop);
    await Promise.all(
      attributions.slice(0, 40).map(async (attr) => {
        try {
          await syncCustomizationForAttribution(
            admin as AdminGraphql,
            {
              id: attr.id,
              shop: session.shop,
              vendorId: attr.vendorId,
              shopifyOrderId: attr.shopifyOrderId,
              shopifyOrderName: attr.shopifyOrderName,
              lineItemsJson: attr.lineItemsJson,
            },
            { notify: false },
          );
        } catch (error) {
          console.error("admin custom sync failed", attr.id, error);
        }
      }),
    );
  } catch (error) {
    console.error("Failed syncing customization requests", error);
  }

  const rows = await listCustomizationRequestsForShop(session.shop);
  return {
    requests: rows.map((row) => {
      let imageUrls: string[] = [];
      try {
        imageUrls = JSON.parse(row.imageUrlsJson || "[]") as string[];
      } catch {
        imageUrls = [];
      }
      return {
        id: row.id,
        orderName: row.orderName || row.shopifyOrderId,
        productTitle: row.productTitle || "Product",
        customerNote: row.customerNote || "",
        sellerNotes: row.sellerNotes || "",
        status: row.status,
        imageUrls,
        createdAt: row.createdAt.toISOString(),
        sellerName: row.vendor.name,
        sellerEmail: row.vendor.email,
        sellerStatus: row.vendor.status,
      };
    }),
  };
};

function statusLabel(status: string) {
  if (status === "accepted") return "Accepted";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

const styles = `
  .nx-c { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-c h1 { font-size: 28px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.02em; }
  .nx-c__sub { margin: 0 0 16px; color: #6d7175; font-size: 14px; }
  .nx-note { margin-bottom: 16px; padding: 10px 12px; border-radius: 8px; background: #eef3ff; color: #1a3a8a; font-size: 13px; }
  .nx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .nx-card { background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; padding: 14px; }
  .nx-card h2 { margin: 0; font-size: 15px; }
  .nx-muted { margin: 4px 0 10px; color: #6d7175; font-size: 12px; }
  .nx-pill { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #fff4e5; color: #8a5a00; }
  .nx-pill.ok { background: #e4f7e9; color: #0d6b2d; }
  .nx-pill.bad { background: #fbeae9; color: #8e1f0b; }
  .nx-img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; border: 1px solid #e4e5e7; display: block; }
  .nx-empty { padding: 24px; text-align: center; color: #6d7175; background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; }
  .nx-btn { border: 1px solid #c9cccf; background: #fff; border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
`;

export default function AdminCustomizations() {
  const { requests } = useLoaderData<typeof loader>();
  const [openId, setOpenId] = useState<string | null>(requests[0]?.id ?? null);

  return (
    <s-page heading="Customizations">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-c">
        <h1>Customization requests</h1>
        <p className="nx-c__sub">
          View submitted design requests and related order details.
        </p>
        <div className="nx-note">
          Administrators can review requests only. Accept, update, and cancel
          are done by the seller in the seller portal.
        </div>

        {requests.length === 0 ? (
          <div className="nx-empty">
            No customization requests yet. They appear when an order includes
            design links in the note, checkout attributes, or line-item
            properties.
          </div>
        ) : (
          <div className="nx-grid">
            {requests.map((row) => {
              const open = openId === row.id;
              const tone =
                row.status === "accepted"
                  ? "ok"
                  : row.status === "cancelled"
                    ? "bad"
                    : "";
              return (
                <article key={row.id} className="nx-card">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "flex-start",
                    }}
                  >
                    <h2>{row.orderName}</h2>
                    <span className={`nx-pill ${tone}`}>
                      {statusLabel(row.status)}
                    </span>
                  </div>
                  <p className="nx-muted">
                    {row.productTitle} · {row.sellerName}
                    <br />
                    {new Date(row.createdAt).toLocaleString()}
                  </p>
                  <button
                    type="button"
                    className="nx-btn"
                    onClick={() => setOpenId(open ? null : row.id)}
                  >
                    {open ? "Hide details" : "Review details"}
                  </button>
                  {open ? (
                    <div style={{ marginTop: 12 }}>
                      <p className="nx-muted" style={{ marginBottom: 6 }}>
                        Seller: {row.sellerName} ({row.sellerEmail}) ·{" "}
                        {row.sellerStatus}
                      </p>
                      {row.customerNote ? (
                        <p style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                          {row.customerNote}
                        </p>
                      ) : (
                        <p className="nx-muted">No customer note.</p>
                      )}
                      {row.sellerNotes ? (
                        <p style={{ fontSize: 13 }}>
                          <strong>Seller notes:</strong> {row.sellerNotes}
                        </p>
                      ) : null}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          marginTop: 8,
                        }}
                      >
                        {row.imageUrls.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              className="nx-img"
                              src={url}
                              alt={`Design for ${row.orderName}`}
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
