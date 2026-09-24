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
    listPayoutsForShop(session.shop, 30),
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
    return { error: "Vendor not found." };
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

export default function AdminPayoutsPage() {
  const { balances, recentPayouts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0);
  const currency = balances.find((b) => b.currency)?.currency || "USD";

  return (
    <s-page heading="Payouts">
      <s-section heading="Overview">
        <s-paragraph>
          Track what vendors have earned vs what you already paid outside
          Shopify (bank transfer, GCash, etc.).
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>Outstanding balance</s-heading>
            <s-text>{formatMoney(totalBalance, currency)}</s-text>
          </s-box>
          <s-button href="/app/payouts?export=csv">Export CSV</s-button>
        </s-stack>
      </s-section>

      {actionData && "error" in actionData && actionData.error && (
        <s-banner tone="critical">{actionData.error}</s-banner>
      )}
      {actionData && "message" in actionData && actionData.message && (
        <s-banner tone="success">{actionData.message}</s-banner>
      )}

      <s-section heading="Vendor balances">
        {balances.length === 0 ? (
          <s-paragraph>No vendors yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {balances.map((row) => (
              <s-box
                key={row.vendorId}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="base">
                  <s-heading>
                    {row.vendorName}{" "}
                    <s-text>
                      ({row.status}) · {row.vendorEmail}
                    </s-text>
                  </s-heading>
                  <s-unordered-list>
                    <s-list-item>
                      Earned: {formatMoney(row.earned, row.currency)}
                    </s-list-item>
                    <s-list-item>
                      Paid: {formatMoney(row.paid, row.currency)}
                    </s-list-item>
                    <s-list-item>
                      Balance: {formatMoney(row.balance, row.currency)}
                    </s-list-item>
                  </s-unordered-list>

                  <Form method="post">
                    <input type="hidden" name="intent" value="markPaid" />
                    <input
                      type="hidden"
                      name="vendorId"
                      value={row.vendorId}
                    />
                    <s-stack direction="block" gap="base">
                      <s-text-field
                        label="Amount paid"
                        name="amount"
                        type="number"
                        defaultValue={
                          row.balance > 0 ? String(row.balance) : ""
                        }
                        min={0.01}
                        step={0.01}
                        required
                      />
                      <s-text-field
                        label="Date paid"
                        name="paidAt"
                        type="date"
                      />
                      <s-text-field
                        label="Reference (GCash/bank ref)"
                        name="reference"
                      />
                      <s-text-field label="Note" name="note" />
                      <s-button
                        type="submit"
                        {...(busy ? { loading: true } : {})}
                      >
                        Mark as paid
                      </s-button>
                    </s-stack>
                  </Form>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Recent payouts">
        {recentPayouts.length === 0 ? (
          <s-paragraph>No payouts recorded yet.</s-paragraph>
        ) : (
          <s-unordered-list>
            {recentPayouts.map((p) => (
              <s-list-item key={p.id}>
                {String(p.paidAt).slice(0, 10)} · {p.vendor.name}:{" "}
                {formatMoney(p.amount, p.currency)}
                {p.reference ? ` · ref ${p.reference}` : ""}
                {p.note ? ` · ${p.note}` : ""}
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
