import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getVendorById } from "../models/vendor.server";
import {
  createVendorPayout,
  listPayoutsForShop,
  listVendorPayoutBalances,
  payoutBalancesToCsv,
} from "../models/payouts.server";
import { formatMoney } from "../utils/money";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  if (url.searchParams.get("export") === "csv") {
    const balances = await listVendorPayoutBalances(session.shop);
    const csv = payoutBalancesToCsv(balances);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vendor-payouts-${session.shop}.csv"`,
      },
    });
  }

  const [balances, recentPayouts] = await Promise.all([
    listVendorPayoutBalances(session.shop),
    listPayoutsForShop(session.shop, 50),
  ]);

  return { balances, recentPayouts };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent !== "markPaid") {
    return { error: "Unknown action." };
  }

  const vendorId = String(form.get("vendorId") || "");
  const amount = Number(form.get("amount"));
  const note = String(form.get("note") || "").trim();
  const reference = String(form.get("reference") || "").trim();
  const paidAtRaw = String(form.get("paidAt") || "").trim();

  const vendor = await getVendorById(vendorId);
  if (!vendor || vendor.shop !== session.shop) {
    return { error: "Seller not found." };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter a payout amount greater than 0." };
  }

  let paidAt = new Date();
  if (paidAtRaw) {
    const parsed = new Date(paidAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "Invalid payout date." };
    }
    paidAt = parsed;
  }

  await createVendorPayout({
    shop: session.shop,
    vendorId,
    amount,
    note: note || null,
    reference: reference || null,
    paidAt,
  });

  return {
    ok: true,
    message: `Recorded payout of ${amount.toFixed(2)} for ${vendor.name}.`,
  };
};

const styles = `
  .nx-pay { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
  .nx-pay__head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 18px; flex-wrap: wrap; }
  .nx-pay__title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .nx-pay__sub { margin: 0; color: #6d7175; font-size: 14px; }
  .nx-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 20px; }
  .nx-metric { background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; padding: 18px 20px; }
  .nx-metric__label { font-size: 13px; color: #6d7175; margin: 0 0 8px; }
  .nx-metric__value { font-size: 24px; font-weight: 700; margin: 0; }
  .nx-btn {
    border: 1px solid #c9cccf; background: #fff; color: #202223; border-radius: 8px;
    padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none;
  }
  .nx-btn--primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  .nx-btn:disabled { opacity: 0.6; cursor: default; }
  .nx-panel { background: #fff; border: 1px solid #e4e5e7; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
  .nx-panel__title { font-size: 16px; font-weight: 700; margin: 0; padding: 16px 16px 0; }
  .nx-table { width: 100%; border-collapse: collapse; }
  .nx-table th {
    text-align: left; font-size: 12px; font-weight: 600; color: #6d7175;
    padding: 12px 16px; border-bottom: 1px solid #e4e5e7; background: #fafbfb;
  }
  .nx-table td { padding: 14px 16px; border-bottom: 1px solid #ececec; vertical-align: top; font-size: 13px; }
  .nx-table tr:last-child td { border-bottom: none; }
  .nx-primary { font-weight: 700; margin: 0 0 2px; }
  .nx-secondary { margin: 0; color: #6d7175; font-size: 12px; }
  .nx-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
  .nx-form label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
  .nx-form input {
    width: 100%; box-sizing: border-box; border: 1px solid #c9cccf; border-radius: 8px; padding: 8px 10px; font-size: 13px;
  }
  .nx-empty { padding: 24px 16px; text-align: center; color: #6d7175; }
  .nx-banner { margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; font-size: 13px; }
  .nx-banner.err { background: #fbeae9; color: #8e1f0b; }
  .nx-banner.ok { background: #e4f7e9; color: #0d6b2d; }
  @media (max-width: 900px) {
    .nx-metrics { grid-template-columns: 1fr; }
    .nx-form { grid-template-columns: 1fr; }
    .nx-table { min-width: 720px; }
    .nx-panel { overflow-x: auto; }
  }
`;

export default function AdminPayoutsPage() {
  const { balances, recentPayouts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [openId, setOpenId] = useState<string | null>(null);

  const totalEarned = balances.reduce((sum, b) => sum + b.earned, 0);
  const totalPaid = balances.reduce((sum, b) => sum + b.paid, 0);
  const totalBalance = balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0);
  const currency = balances.find((b) => b.currency)?.currency || "USD";

  return (
    <s-page heading="Payouts">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div className="nx-pay">
        <div className="nx-pay__head">
          <div>
            <h1 className="nx-pay__title">Payouts</h1>
            <p className="nx-pay__sub">
              Track seller earnings vs what you paid outside Shopify (bank,
              GCash, etc.).
            </p>
          </div>
          <a className="nx-btn" href="/app/payouts?export=csv">
            Export CSV
          </a>
        </div>

        {actionData && "error" in actionData && actionData.error && (
          <div className="nx-banner err">{actionData.error}</div>
        )}
        {actionData && "message" in actionData && actionData.message && (
          <div className="nx-banner ok">{actionData.message}</div>
        )}

        <div className="nx-metrics">
          <div className="nx-metric">
            <p className="nx-metric__label">Total earned by sellers</p>
            <p className="nx-metric__value">
              {formatMoney(totalEarned, currency)}
            </p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Already paid</p>
            <p className="nx-metric__value">
              {formatMoney(totalPaid, currency)}
            </p>
          </div>
          <div className="nx-metric">
            <p className="nx-metric__label">Outstanding balance</p>
            <p className="nx-metric__value">
              {formatMoney(totalBalance, currency)}
            </p>
          </div>
        </div>

        <div className="nx-panel">
          <h2 className="nx-panel__title">Seller balances</h2>
          {balances.length === 0 ? (
            <div className="nx-empty">No sellers yet.</div>
          ) : (
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Seller</th>
                  <th>Earned</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((row) => {
                  const open = openId === row.vendorId;
                  return (
                    <tr key={row.vendorId}>
                      <td>
                        <p className="nx-primary">{row.vendorName}</p>
                        <p className="nx-secondary">
                          {row.vendorEmail} · {row.status}
                        </p>
                      </td>
                      <td>{formatMoney(row.earned, row.currency)}</td>
                      <td>{formatMoney(row.paid, row.currency)}</td>
                      <td>{formatMoney(row.balance, row.currency)}</td>
                      <td>
                        <button
                          type="button"
                          className="nx-btn"
                          onClick={() =>
                            setOpenId(open ? null : row.vendorId)
                          }
                        >
                          {open ? "Hide" : "Mark paid"}
                        </button>
                        {open && (
                          <Form method="post">
                            <input type="hidden" name="intent" value="markPaid" />
                            <input
                              type="hidden"
                              name="vendorId"
                              value={row.vendorId}
                            />
                            <div className="nx-form">
                              <div>
                                <label>Amount</label>
                                <input
                                  name="amount"
                                  type="number"
                                  min={0.01}
                                  step={0.01}
                                  required
                                  defaultValue={
                                    row.balance > 0 ? String(row.balance) : ""
                                  }
                                />
                              </div>
                              <div>
                                <label>Date paid</label>
                                <input name="paidAt" type="date" />
                              </div>
                              <div>
                                <label>Reference</label>
                                <input name="reference" placeholder="GCash / bank ref" />
                              </div>
                              <div>
                                <label>Note</label>
                                <input name="note" />
                              </div>
                            </div>
                            <div style={{ marginTop: 8 }}>
                              <button
                                className="nx-btn nx-btn--primary"
                                type="submit"
                                disabled={busy}
                              >
                                {busy ? "Saving…" : "Save payout"}
                              </button>
                            </div>
                          </Form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="nx-panel">
          <h2 className="nx-panel__title">Recent payouts</h2>
          {recentPayouts.length === 0 ? (
            <div className="nx-empty">No payouts recorded yet.</div>
          ) : (
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Seller</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {recentPayouts.map((p) => (
                  <tr key={p.id}>
                    <td>{String(p.paidAt).slice(0, 10)}</td>
                    <td>{p.vendor.name}</td>
                    <td>{formatMoney(p.amount, p.currency)}</td>
                    <td>{p.reference || "—"}</td>
                    <td>{p.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
