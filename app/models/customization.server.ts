import prisma from "../db.server";

export type CustomizationStatus = "pending" | "accepted" | "cancelled";

export async function upsertCustomizationRequest(data: {
  shop: string;
  vendorId: string;
  attributionId: string;
  shopifyOrderId: string;
  orderName?: string | null;
  productTitle?: string | null;
  customerNote?: string | null;
  imageUrls: string[];
}) {
  const imageUrlsJson = JSON.stringify(data.imageUrls || []);
  return prisma.customizationRequest.upsert({
    where: { attributionId: data.attributionId },
    create: {
      shop: data.shop,
      vendorId: data.vendorId,
      attributionId: data.attributionId,
      shopifyOrderId: data.shopifyOrderId,
      orderName: data.orderName ?? null,
      productTitle: data.productTitle ?? null,
      customerNote: data.customerNote ?? null,
      imageUrlsJson,
      status: "pending",
    },
    update: {
      orderName: data.orderName ?? null,
      productTitle: data.productTitle ?? null,
      customerNote: data.customerNote ?? null,
      imageUrlsJson,
      // keep status / sellerNotes
    },
  });
}

export async function listCustomizationRequestsForVendor(vendorId: string) {
  return prisma.customizationRequest.findMany({
    where: { vendorId },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getCustomizationRequestForVendor(
  id: string,
  vendorId: string,
) {
  return prisma.customizationRequest.findFirst({
    where: { id, vendorId },
  });
}

export async function updateCustomizationRequest(
  id: string,
  vendorId: string,
  data: {
    status?: CustomizationStatus;
    sellerNotes?: string | null;
  },
) {
  const existing = await getCustomizationRequestForVendor(id, vendorId);
  if (!existing) return null;
  return prisma.customizationRequest.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.sellerNotes !== undefined
        ? { sellerNotes: data.sellerNotes?.trim() || null }
        : {}),
    },
  });
}
