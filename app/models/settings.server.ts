import prisma from "../db.server";

export async function getOrCreateSettings(shop: string) {
  return prisma.appSettings.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });
}

export async function updateSettings(
  shop: string,
  data: {
    defaultCommissionPercent?: number;
    requireProductApproval?: boolean;
  },
) {
  return prisma.appSettings.upsert({
    where: { shop },
    create: {
      shop,
      defaultCommissionPercent: data.defaultCommissionPercent ?? 10,
      requireProductApproval: data.requireProductApproval ?? false,
    },
    update: data,
  });
}
