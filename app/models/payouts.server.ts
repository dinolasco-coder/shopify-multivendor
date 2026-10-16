import prisma from "../db.server";
import { effectiveCommissionAmount } from "../utils/commission-flag";
import { vendorReadyForPaymongo } from "../services/auto-payout.server";

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

/** Amounts that reduce outstanding balance (pending + succeeded). Failed does not. */
function countsTowardPaid(status: string | null | undefined) {
  return !status || status === "succeeded" || status === "pending";
}

export async function createVendorPayout(data: {
  shop: string;
  vendorId: string;
  amount: number;
  currency?: string;
  note?: string | null;
  reference?: string | null;
  paidAt?: Date;
  status?: string;
  provider?: string;
  attributionId?: string | null;
  providerTransferId?: string | null;
  providerBatchId?: string | null;
  errorMessage?: string | null;
}) {
  const payout = await prisma.vendorPayout.create({
    data: {
      shop: data.shop,
      vendorId: data.vendorId,
      amount: roundMoney(data.amount),
      currency: data.currency ?? "PHP",
      note: data.note?.trim() || null,
      reference: data.reference?.trim() || null,
      paidAt: data.paidAt ?? new Date(),
      status: data.status ?? "succeeded",
      provider: data.provider ?? "manual",
      attributionId: data.attributionId ?? null,
      providerTransferId: data.providerTransferId ?? null,
      providerBatchId: data.providerBatchId ?? null,
      errorMessage: data.errorMessage ?? null,
    },
  });

  try {
    const { notifyPayment } = await import("./notifications.server");
    const { formatMoney } = await import("../utils/money");
    await notifyPayment({
      shop: payout.shop,
      vendorId: payout.vendorId,
      amountLabel: formatMoney(payout.amount, payout.currency),
      payoutId: payout.id,
      statusLabel: payout.status || "recorded",
    });
  } catch (error) {
    console.error("notify payment failed", error);
  }

  return payout;
}

/** Record outstanding balances for every seller owed money. */
export async function markAllOutstandingPaid(
  shop: string,
  opts?: { note?: string | null; reference?: string | null; paidAt?: Date },
) {
  const balances = await listVendorPayoutBalances(shop);
  const owed = balances.filter((b) => b.balance > 0.009);
  if (owed.length === 0) {
    return { count: 0, total: 0, currency: "PHP" as string };
  }

  const paidAt = opts?.paidAt ?? new Date();
  const note = opts?.note?.trim() || "Bulk payout — all sellers";
  const reference = opts?.reference?.trim() || null;

  await prisma.vendorPayout.createMany({
    data: owed.map((b) => ({
      shop,
      vendorId: b.vendorId,
      amount: roundMoney(b.balance),
      currency: b.currency || "PHP",
      note,
      reference,
      paidAt,
      status: "succeeded",
      provider: "manual",
    })),
  });

  const total = owed.reduce((sum, b) => sum + b.balance, 0);
  return {
    count: owed.length,
    total: roundMoney(total),
    currency: owed[0]?.currency || "PHP",
  };
}

export async function listPayoutsForShop(shop: string, limit = 50) {
  return prisma.vendorPayout.findMany({
    where: { shop },
    include: { vendor: true },
    orderBy: { paidAt: "desc" },
    take: limit,
  });
}

export async function listPayoutsForVendor(vendorId: string, limit = 50) {
  return prisma.vendorPayout.findMany({
    where: { vendorId },
    orderBy: { paidAt: "desc" },
    take: limit,
  });
}

export type VendorPayoutBalance = {
  vendorId: string;
  vendorName: string;
  vendorEmail: string;
  status: string;
  currency: string;
  revenue: number;
  commission: number;
  earned: number;
  paid: number;
  balance: number;
  payoutMethod: string | null;
  payoutAccountName: string | null;
  payoutAccountNumber: string | null;
  payoutBankBic: string | null;
  payoutNotes: string | null;
  autoPayReady: boolean;
};

/** Per-vendor: earned (revenue - commission), paid, and outstanding balance. */
export async function listVendorPayoutBalances(
  shop: string,
): Promise<VendorPayoutBalance[]> {
  const vendors = await prisma.vendor.findMany({
    where: { shop },
    orderBy: { name: "asc" },
  });

  const attributions = await prisma.orderAttribution.findMany({
    where: { shop },
  });
  const payouts = await prisma.vendorPayout.findMany({ where: { shop } });

  return vendors.map((vendor) => {
    const rows = attributions.filter((a) => a.vendorId === vendor.id);
    const revenue = rows.reduce((sum, r) => sum + r.subtotal, 0);
    const commission = effectiveCommissionAmount(
      rows.reduce((sum, r) => sum + r.commissionAmount, 0),
    );
    const earned = revenue - commission;
    const paid = payouts
      .filter((p) => p.vendorId === vendor.id && countsTowardPaid(p.status))
      .reduce((sum, p) => sum + p.amount, 0);
    const currency =
      rows[0]?.currency ||
      payouts.find((p) => p.vendorId === vendor.id)?.currency ||
      "PHP";

    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorEmail: vendor.email,
      status: vendor.status,
      currency,
      revenue: roundMoney(revenue),
      commission: roundMoney(commission),
      earned: roundMoney(earned),
      paid: roundMoney(paid),
      balance: roundMoney(earned - paid),
      payoutMethod: vendor.payoutMethod ?? null,
      payoutAccountName: vendor.payoutAccountName ?? null,
      payoutAccountNumber: vendor.payoutAccountNumber ?? null,
      payoutBankBic: vendor.payoutBankBic ?? null,
      payoutNotes: vendor.payoutNotes ?? null,
      autoPayReady: vendorReadyForPaymongo(vendor),
    };
  });
}

export async function getVendorEarningsSummary(vendorId: string) {
  const [attributions, payouts] = await Promise.all([
    prisma.orderAttribution.findMany({ where: { vendorId } }),
    prisma.vendorPayout.findMany({
      where: { vendorId },
      orderBy: { paidAt: "desc" },
    }),
  ]);

  const revenue = attributions.reduce((sum, r) => sum + r.subtotal, 0);
  const commission = effectiveCommissionAmount(
    attributions.reduce((sum, r) => sum + r.commissionAmount, 0),
  );
  const earned = revenue - commission;
  const paid = payouts
    .filter((p) => countsTowardPaid(p.status))
    .reduce((sum, p) => sum + p.amount, 0);
  const currency =
    attributions[0]?.currency || payouts[0]?.currency || "PHP";

  return {
    orderCount: attributions.length,
    revenue: roundMoney(revenue),
    commission: roundMoney(commission),
    earned: roundMoney(earned),
    paid: roundMoney(paid),
    pending: roundMoney(earned - paid),
    currency,
    payouts,
  };
}

export function payoutBalancesToCsv(rows: VendorPayoutBalance[]) {
  const header = [
    "vendor_name",
    "vendor_email",
    "status",
    "currency",
    "earned",
    "paid",
    "balance",
    "payout_method",
    "payout_account_name",
    "payout_account_number",
    "payout_bank_bic",
    "payout_notes",
    "auto_pay_ready",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        csvEscape(r.vendorName),
        csvEscape(r.vendorEmail),
        r.status,
        r.currency,
        r.earned.toFixed(2),
        r.paid.toFixed(2),
        r.balance.toFixed(2),
        csvEscape(r.payoutMethod || ""),
        csvEscape(r.payoutAccountName || ""),
        csvEscape(r.payoutAccountNumber || ""),
        csvEscape(r.payoutBankBic || ""),
        csvEscape(r.payoutNotes || ""),
        r.autoPayReady ? "yes" : "no",
      ].join(","),
    ),
  ];
  return lines.join("\n");
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
