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
    defaultCommissionFlat?: number;
    requireProductApproval?: boolean;
    allowPublicRegistration?: boolean;
  },
) {
  return prisma.appSettings.upsert({
    where: { shop },
    create: {
      shop,
      defaultCommissionPercent: data.defaultCommissionPercent ?? 10,
      defaultCommissionFlat: data.defaultCommissionFlat ?? 0,
      requireProductApproval: data.requireProductApproval ?? false,
      allowPublicRegistration: data.allowPublicRegistration ?? true,
    },
    update: data,
  });
}
