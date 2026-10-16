import prisma from "../db.server";
import { effectiveCommissionAmount } from "../utils/commission-flag";
import {
  createBatchTransfer,
  isPaymongoAutoPayoutsEnabled,
  isPaymongoConfigured,
  pesosToCentavos,
} from "./paymongo.server";

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

export function vendorReadyForPaymongo(vendor: {
  payoutAccountName?: string | null;
  payoutAccountNumber?: string | null;
  payoutBankBic?: string | null;
}): boolean {
  return Boolean(
    vendor.payoutAccountName?.trim() &&
      vendor.payoutAccountNumber?.trim() &&
      vendor.payoutBankBic?.trim(),
  );
}

async function existingActivePayoutForAttribution(attributionId: string) {
  return prisma.vendorPayout.findFirst({
    where: {
      attributionId,
      status: { in: ["pending", "succeeded"] },
    },
  });
}

/** Send one PayMongo transfer for a vendor amount; returns payout row. */
export async function sendPaymongoPayout(opts: {
  shop: string;
  vendorId: string;
  amount: number;
  currency?: string;
  note?: string | null;
  attributionId?: string | null;
  referencePrefix?: string;
}) {
  if (!isPaymongoConfigured()) {
    throw new Error("PayMongo is not configured (PAYMONGO_SECRET_KEY).");
  }

  const amount = roundMoney(opts.amount);
  if (amount <= 0.009) {
    throw new Error("Payout amount must be greater than 0.");
  }

  const vendor = await prisma.vendor.findUnique({ where: { id: opts.vendorId } });
  if (!vendor || vendor.shop !== opts.shop) {
    throw new Error("Seller not found.");
  }
  if (!vendorReadyForPaymongo(vendor)) {
    throw new Error(
      "Seller is missing payout details (account name, number, and bank/GCash BIC).",
    );
  }

  if (opts.attributionId) {
    const existing = await existingActivePayoutForAttribution(opts.attributionId);
    if (existing) {
      return { payout: existing, skipped: true as const };
    }
  }

  const reference = `${opts.referencePrefix || "po"}-${Date.now()}-${opts.vendorId.slice(-6)}`;

  const payout = await prisma.vendorPayout.create({
    data: {
      shop: opts.shop,
      vendorId: opts.vendorId,
      amount,
      currency: opts.currency || "PHP",
      note: opts.note?.trim() || "PayMongo auto-payout",
      reference,
      paidAt: new Date(),
      status: "pending",
      provider: "paymongo",
      attributionId: opts.attributionId || null,
    },
  });

  try {
    const result = await createBatchTransfer(
      {
        amountCentavos: pesosToCentavos(amount),
        currency: opts.currency || "PHP",
        description: opts.note || `Seller payout ${vendor.name}`,
        referenceNumber: reference.slice(0, 35),
        destination: {
          number: vendor.payoutAccountNumber!.trim(),
          name: vendor.payoutAccountName!.trim(),
          bic: vendor.payoutBankBic!.trim(),
        },
        metadata: {
          vendor_id: vendor.id,
          payout_id: payout.id,
          ...(opts.attributionId ? { attribution_id: opts.attributionId } : {}),
        },
      },
      { idempotencyKey: payout.id },
    );

    const status =
      result.status === "succeeded" || result.status === "success"
        ? "succeeded"
        : result.status === "failed"
          ? "failed"
          : "pending";

    const updated = await prisma.vendorPayout.update({
      where: { id: payout.id },
      data: {
        providerBatchId: result.batchId,
        providerTransferId: result.transferId,
        status,
      },
    });

    try {
      const { notifyPayment } = await import("../models/notifications.server");
      const { formatMoney } = await import("../utils/money");
      await notifyPayment({
        shop: updated.shop,
        vendorId: updated.vendorId,
        amountLabel: formatMoney(updated.amount, updated.currency),
        payoutId: updated.id,
        statusLabel: status,
      });
    } catch (notifyError) {
      console.error("notify paymongo payout failed", notifyError);
    }

    return { payout: updated, skipped: false as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PayMongo transfer failed.";
    const updated = await prisma.vendorPayout.update({
      where: { id: payout.id },
      data: {
        status: "failed",
        errorMessage: message.slice(0, 500),
      },
    });
    try {
      const { notifyPayment } = await import("../models/notifications.server");
      const { formatMoney } = await import("../utils/money");
      await notifyPayment({
        shop: updated.shop,
        vendorId: updated.vendorId,
        amountLabel: formatMoney(updated.amount, updated.currency),
        payoutId: updated.id,
        statusLabel: "failed",
      });
    } catch (notifyError) {
      console.error("notify paymongo fail failed", notifyError);
    }
    return { payout: updated, skipped: false as const, error: message };
  }
}

/**
 * After order attribution: auto-disburse each seller share via PayMongo when enabled.
 */
export async function autoPayoutForOrder(
  shop: string,
  shopifyOrderId: string,
): Promise<{ attempted: number; paid: number; skipped: number; failed: number }> {
  if (!isPaymongoAutoPayoutsEnabled() || !isPaymongoConfigured()) {
    return { attempted: 0, paid: 0, skipped: 0, failed: 0 };
  }

  const attributions = await prisma.orderAttribution.findMany({
    where: { shop, shopifyOrderId },
    include: { vendor: true },
  });

  let attempted = 0;
  let paid = 0;
  let skipped = 0;
  let failed = 0;

  for (const attr of attributions) {
    const commission = effectiveCommissionAmount(attr.commissionAmount);
    const earned = roundMoney(attr.subtotal - commission);
    if (earned <= 0.009) {
      skipped += 1;
      continue;
    }
    if (!vendorReadyForPaymongo(attr.vendor)) {
      skipped += 1;
      continue;
    }

    const existing = await existingActivePayoutForAttribution(attr.id);
    if (existing) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    const result = await sendPaymongoPayout({
      shop,
      vendorId: attr.vendorId,
      amount: earned,
      currency: attr.currency,
      note: `Auto-payout for ${attr.shopifyOrderName || attr.shopifyOrderId}`,
      attributionId: attr.id,
      referencePrefix: "auto",
    });

    if (result.skipped) {
      skipped += 1;
    } else if (result.payout.status === "failed") {
      failed += 1;
    } else {
      paid += 1;
    }
  }

  return { attempted, paid, skipped, failed };
}

/** Retry a failed PayMongo payout (same amount/vendor; new transfer). */
export async function retryFailedPaymongoPayout(payoutId: string, shop: string) {
  const payout = await prisma.vendorPayout.findUnique({ where: { id: payoutId } });
  if (!payout || payout.shop !== shop) {
    throw new Error("Payout not found.");
  }
  if (payout.provider !== "paymongo" || payout.status !== "failed") {
    throw new Error("Only failed PayMongo payouts can be retried.");
  }

  return sendPaymongoPayout({
    shop,
    vendorId: payout.vendorId,
    amount: payout.amount,
    currency: payout.currency,
    note: payout.note || "PayMongo retry",
    attributionId: payout.attributionId,
    referencePrefix: "retry",
  });
}

export async function applyPaymongoTransferStatus(payload: {
  transferId?: string | null;
  status?: string | null;
  failureMessage?: string | null;
}) {
  const transferId = payload.transferId?.trim();
  if (!transferId) return null;

  const payout = await prisma.vendorPayout.findFirst({
    where: { providerTransferId: transferId },
  });
  if (!payout) return null;

  const raw = (payload.status || "").toLowerCase();
  let status = payout.status;
  if (raw === "succeeded" || raw === "success" || raw === "completed") {
    status = "succeeded";
  } else if (raw === "failed" || raw === "cancelled" || raw === "canceled") {
    status = "failed";
  } else if (raw === "pending" || raw === "processing") {
    status = "pending";
  }

  const updated = await prisma.vendorPayout.update({
    where: { id: payout.id },
    data: {
      status,
      errorMessage:
        status === "failed"
          ? (payload.failureMessage || payout.errorMessage || "Transfer failed").slice(
              0,
              500,
            )
          : status === "succeeded"
            ? null
            : payout.errorMessage,
    },
  });

  try {
    const { notifyPayment } = await import("../models/notifications.server");
    const { formatMoney } = await import("../utils/money");
    await notifyPayment({
      shop: updated.shop,
      vendorId: updated.vendorId,
      amountLabel: formatMoney(updated.amount, updated.currency),
      payoutId: updated.id,
      statusLabel: status,
    });
  } catch (notifyError) {
    console.error("notify paymongo webhook status failed", notifyError);
  }

  return updated;
}
