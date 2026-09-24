import prisma from "../db.server";
import type { VendorStatus } from "../constants";

export async function listVendors(shop: string) {
  return prisma.vendor.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

export async function getVendorById(id: string) {
  return prisma.vendor.findUnique({ where: { id } });
}

export async function getVendorByEmail(shop: string, email: string) {
  return prisma.vendor.findUnique({
    where: { shop_email: { shop, email: email.toLowerCase() } },
  });
}

export async function createVendor(data: {
  shop: string;
  name: string;
  email: string;
  passwordHash: string;
  commissionPercent?: number;
  status?: VendorStatus;
}) {
  return prisma.vendor.create({
    data: {
      shop: data.shop,
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash: data.passwordHash,
      commissionPercent: data.commissionPercent ?? 10,
      status: data.status ?? "pending",
    },
  });
}

export async function updateVendor(
  id: string,
  data: {
    name?: string;
    status?: VendorStatus;
    commissionPercent?: number;
    shopifyCollectionId?: string | null;
    bio?: string | null;
  },
) {
  return prisma.vendor.update({ where: { id }, data });
}

export async function countVendorsByStatus(shop: string) {
  const groups = await prisma.vendor.groupBy({
    by: ["status"],
    where: { shop },
    _count: { _all: true },
  });
  return Object.fromEntries(
    groups.map((g) => [g.status, g._count._all]),
  ) as Record<string, number>;
}
