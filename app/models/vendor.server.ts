import prisma from "../db.server";
import type { VendorStatus } from "../constants";

export function slugifyVendorName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "seller";
}

export async function allocateVendorSlug(shop: string, name: string, excludeId?: string) {
  const base = slugifyVendorName(name);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await prisma.vendor.findFirst({
      where: {
        shop,
        slug: candidate,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Ensure older rows have a usable human slug. */
export async function ensureVendorSlug(vendor: {
  id: string;
  shop: string;
  name: string;
  slug: string;
}) {
  // Keep nice slugs; upgrade placeholder ids from migration backfill.
  if (vendor.slug?.trim() && vendor.slug !== vendor.id) return vendor.slug;
  const slug = await allocateVendorSlug(vendor.shop, vendor.name, vendor.id);
  await prisma.vendor.update({ where: { id: vendor.id }, data: { slug } });
  return slug;
}

export async function listVendors(shop: string) {
  return prisma.vendor.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

export async function getVendorById(id: string) {
  return prisma.vendor.findUnique({ where: { id } });
}

export async function getVendorBySlug(shop: string, slug: string) {
  return prisma.vendor.findFirst({
    where: { shop, slug: slug.toLowerCase() },
  });
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
  const slug = await allocateVendorSlug(data.shop, data.name);
  return prisma.vendor.create({
    data: {
      shop: data.shop,
      name: data.name,
      slug,
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
    passwordHash?: string;
    slug?: string;
  },
) {
  return prisma.vendor.update({ where: { id }, data });
}

export async function deleteVendor(id: string) {
  // Sessions, attributions, and payouts cascade via Prisma relations.
  return prisma.vendor.delete({ where: { id } });
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
