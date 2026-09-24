import prisma from "../db.server";

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

export async function createVendorPayout(data: {
  shop: string;
  vendorId: string;
  amount: number;
  currency?: string;
  note?: string | null;
  reference?: string | null;
  paidAt?: Date;
}) {
  return prisma.vendorPayout.create({
    data: {
      shop: data.shop,
      vendorId: data.vendorId,
      amount: roundMoney(data.amount),
      currency: data.currency ?? "USD",
      note: data.note?.trim() || null,
      reference: data.reference?.trim() || null,
      paidAt: data.paidAt ?? new Date(),
    },
  });
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
    const commission = rows.reduce((sum, r) => sum + r.commissionAmount, 0);
    const earned = revenue - commission;
    const paid = payouts
      .filter((p) => p.vendorId === vendor.id)
      .reduce((sum, p) => sum + p.amount, 0);
    const currency =
      rows[0]?.currency ||
      payouts.find((p) => p.vendorId === vendor.id)?.currency ||
      "USD";

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
  const commission = attributions.reduce(
    (sum, r) => sum + r.commissionAmount,
    0,
  );
  const earned = revenue - commission;
  const paid = payouts.reduce((sum, p) => sum + p.amount, 0);
  const currency =
    attributions[0]?.currency || payouts[0]?.currency || "USD";

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
