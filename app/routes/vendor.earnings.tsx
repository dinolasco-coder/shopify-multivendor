import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import { getVendorEarningsSummary } from "../models/payouts.server";
import { updateVendor } from "../models/vendor.server";
import { vendorReadyForPaymongo } from "../services/auto-payout.server";
import {
  PAYMONGO_INSTITUTIONS,
  defaultBicForMethod,
  institutionLabel,
} from "../constants/paymongo-institutions";
import { formatMoney } from "../utils/money";
import { COMMISSION_ENABLED } from "../utils/commission-flag";

const PAYOUT_METHODS = [
  { value: "gcash", label: "GCash" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
] as const;

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  border: "1px solid #c9cccf",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
};

const labelStyle = {
  display: "block" as const,
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const summary = await getVendorEarningsSummary(result.vendor.id);
  const payout = {
    method: result.vendor.payoutMethod ?? "",
    accountName: result.vendor.payoutAccountName ?? "",
    accountNumber: result.vendor.payoutAccountNumber ?? "",
    bankBic: result.vendor.payoutBankBic ?? "",
    notes: result.vendor.payoutNotes ?? "",
  };
  return {
    summary,
    commissionPercent: result.vendor.commissionPercent,
    commissionFlat:
      "commissionFlat" in result.vendor
        ? Number((result.vendor as { commissionFlat?: number }).commissionFlat ?? 0)
        : 0,
    payout,
    autoPayReady: vendorReadyForPaymongo(result.vendor),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;

  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (intent !== "savePayoutDetails") {
    return { error: "Unknown action." };
  }

  const method = String(form.get("payoutMethod") || "").trim().toLowerCase();
  const accountName = String(form.get("payoutAccountName") || "").trim();
  const accountNumber = String(form.get("payoutAccountNumber") || "").trim();
  let bankBic = String(form.get("payoutBankBic") || "").trim().toUpperCase();
  const notes = String(form.get("payoutNotes") || "").trim();

  if (method && !PAYOUT_METHODS.some((m) => m.value === method)) {
    return { error: "Choose a valid payout method." };
  }
  if (method && !accountNumber) {
    return { error: "Add your GCash number or bank account number." };
  }
  if (method && !accountName) {
    return { error: "Add the account name." };
  }
  if (!bankBic && method === "gcash") {
    bankBic = defaultBicForMethod("gcash") || "";
  }
  if (method && !bankBic) {
    return { error: "Select your bank / e-wallet (required for auto-pay)." };
  }

  await updateVendor(result.vendor.id, {
    payoutMethod: method || null,
    payoutAccountName: accountName || null,
    payoutAccountNumber: accountNumber || null,
    payoutBankBic: bankBic || null,
    payoutNotes: notes || null,
  });

  return {
    ok: true,
    message: bankBic
      ? "Payout details saved. You are ready for auto-pay."
      : "Payout details saved.",
  };
};

function methodLabel(value: string) {
  return PAYOUT_METHODS.find((m) => m.value === value)?.label || value || "—";
}

export default function VendorEarnings() {
  const { summary, commissionPercent, commissionFlat, payout, autoPayReady } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div>
      <h1 className="sx-title">Payouts</h1>
      <p className="sx-sub">
        {COMMISSION_ENABLED
          ? `Platform commission: ${commissionPercent}%${
              commissionFlat > 0
                ? ` + flat ${formatMoney(commissionFlat, summary.currency)} per order`
                : ""
            }. `
          : ""}
        Save your GCash or bank details so the store can auto-pay you via
        PayMongo after each sale.
      </p>

      {actionData && "error" in actionData && actionData.error ? (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "#fbeae9",
            color: "#8e1f0b",
            fontSize: 13,
          }}
        >
          {actionData.error}
        </div>
      ) : null}
      {actionData && "message" in actionData && actionData.message ? (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "#e4f7e9",
            color: "#0d6b2d",
            fontSize: 13,
          }}
        >
          {actionData.message}
        </div>
      ) : null}

      <div
        style={{
          marginBottom: 12,
          padding: "10px 12px",
          borderRadius: 8,
          background: autoPayReady ? "#e4f7e9" : "#fff4e5",
          color: autoPayReady ? "#0d6b2d" : "#8a5a00",
          fontSize: 13,
        }}
      >
        {autoPayReady
          ? "Auto-pay ready — your share can be sent via PayMongo after each sale."
          : "Complete account name, number, and bank/e-wallet below to enable auto-pay."}
      </div>

      <div className="sx-metrics">
        <div className="sx-metric">
          <p className="sx-metric__label">
            {COMMISSION_ENABLED ? "Gross revenue" : "Revenue"}
          </p>
          <p className="sx-metric__value">
            {formatMoney(summary.revenue, summary.currency)}
          </p>
        </div>
        {COMMISSION_ENABLED ? (
          <div className="sx-metric">
            <p className="sx-metric__label">Platform commission</p>
            <p className="sx-metric__value">
              {formatMoney(summary.commission, summary.currency)}
            </p>
          </div>
        ) : null}
        <div className="sx-metric">
          <p className="sx-metric__label">Your earnings</p>
          <p className="sx-metric__value">
            {formatMoney(summary.earned, summary.currency)}
          </p>
        </div>
        <div className="sx-metric">
          <p className="sx-metric__label">Pending payout</p>
          <p className="sx-metric__value">
            {formatMoney(summary.pending, summary.currency)}
          </p>
        </div>
      </div>

      <div className="sx-panel" style={{ marginBottom: 16 }}>
        <h2 className="sx-panel__title">How you get paid</h2>
        <p className="sx-sub" style={{ marginTop: 0 }}>
          {payout.method
            ? `Current: ${methodLabel(payout.method)}${
                payout.bankBic
                  ? ` · ${institutionLabel(payout.bankBic) || payout.bankBic}`
                  : ""
              }.`
            : "Not set yet."}
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="savePayoutDetails" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <label htmlFor="vendor-payout-method" style={labelStyle}>
                Method
              </label>
              <select
                id="vendor-payout-method"
                name="payoutMethod"
                defaultValue={payout.method}
                style={fieldStyle}
              >
                <option value="">Select…</option>
                {PAYOUT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="vendor-payout-bic" style={labelStyle}>
                Bank / e-wallet
              </label>
              <select
                id="vendor-payout-bic"
                name="payoutBankBic"
                defaultValue={
                  payout.bankBic ||
                  (payout.method === "gcash"
                    ? defaultBicForMethod("gcash") || ""
                    : "")
                }
                style={fieldStyle}
                required
              >
                <option value="">Select institution…</option>
                {PAYMONGO_INSTITUTIONS.map((i) => (
                  <option key={i.bic} value={i.bic}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="vendor-payout-name" style={labelStyle}>
                Account name
              </label>
              <input
                id="vendor-payout-name"
                name="payoutAccountName"
                defaultValue={payout.accountName}
                placeholder="Full name on account"
                style={fieldStyle}
                required
              />
            </div>
            <div>
              <label htmlFor="vendor-payout-number" style={labelStyle}>
                GCash / account number
              </label>
              <input
                id="vendor-payout-number"
                name="payoutAccountNumber"
                defaultValue={payout.accountNumber}
                placeholder="09XXXXXXXXX or account #"
                style={fieldStyle}
                required
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="vendor-payout-notes" style={labelStyle}>
                Notes (optional)
              </label>
              <input
                id="vendor-payout-notes"
                name="payoutNotes"
                defaultValue={payout.notes}
                placeholder="Branch or other notes"
                style={fieldStyle}
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="sx-btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save payout details"}
            </button>
          </div>
        </Form>
      </div>

      <div className="sx-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 16px 0" }}>
          <h2 className="sx-panel__title">Payout history</h2>
        </div>
        {summary.payouts.length === 0 ? (
          <div className="sx-empty">No payouts recorded yet.</div>
        ) : (
          <div className="sx-table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {summary.payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.paidAt).toISOString().slice(0, 10)}</td>
                    <td>{formatMoney(p.amount, p.currency)}</td>
                    <td>{p.provider || "manual"}</td>
                    <td>
                      {p.status || "succeeded"}
                      {p.errorMessage ? (
                        <div style={{ fontSize: 12, color: "#8e1f0b" }}>
                          {p.errorMessage}
                        </div>
                      ) : null}
                    </td>
                    <td>{p.reference || p.providerTransferId || "—"}</td>
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
