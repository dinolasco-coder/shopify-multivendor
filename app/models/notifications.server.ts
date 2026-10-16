import prisma from "../db.server";

export type NotificationType = "order_status" | "payment" | "customization";

export async function createVendorNotification(data: {
  shop: string;
  vendorId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  href?: string | null;
  refKey?: string | null;
}) {
  const refKey = data.refKey?.trim() || null;
  if (refKey) {
    try {
      return await prisma.vendorNotification.upsert({
        where: {
          vendorId_type_refKey: {
            vendorId: data.vendorId,
            type: data.type,
            refKey,
          },
        },
        create: {
          shop: data.shop,
          vendorId: data.vendorId,
          type: data.type,
          title: data.title,
          body: data.body?.trim() || null,
          href: data.href || null,
          refKey,
        },
        update: {
          title: data.title,
          body: data.body?.trim() || null,
          href: data.href || null,
          // Re-surface as unread when the same event updates (e.g. payment status)
          readAt: null,
        },
      });
    } catch {
      // Unique race or null refKey quirks — fall through to create
    }
  }

  return prisma.vendorNotification.create({
    data: {
      shop: data.shop,
      vendorId: data.vendorId,
      type: data.type,
      title: data.title,
      body: data.body?.trim() || null,
      href: data.href || null,
      refKey,
    },
  });
}

export async function listVendorNotifications(vendorId: string, limit = 50) {
  return prisma.vendorNotification.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function countUnreadNotifications(vendorId: string) {
  return prisma.vendorNotification.count({
    where: { vendorId, readAt: null },
  });
}

export async function markNotificationRead(id: string, vendorId: string) {
  return prisma.vendorNotification.updateMany({
    where: { id, vendorId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(vendorId: string) {
  return prisma.vendorNotification.updateMany({
    where: { vendorId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function notifyOrderStatus(opts: {
  shop: string;
  vendorId: string;
  orderName: string;
  orderId: string;
  statusLabel: string;
  refSuffix: string;
}) {
  return createVendorNotification({
    shop: opts.shop,
    vendorId: opts.vendorId,
    type: "order_status",
    title: `Order ${opts.orderName} — ${opts.statusLabel}`,
    body: `Status update: ${opts.statusLabel}.`,
    href: "/vendor/orders",
    refKey: `order:${opts.orderId}:${opts.refSuffix}`,
  });
}

export async function notifyPayment(opts: {
  shop: string;
  vendorId: string;
  amountLabel: string;
  payoutId: string;
  statusLabel: string;
}) {
  return createVendorNotification({
    shop: opts.shop,
    vendorId: opts.vendorId,
    type: "payment",
    title: `Payment ${opts.statusLabel}`,
    body: `${opts.amountLabel} — ${opts.statusLabel}.`,
    href: "/vendor/earnings",
    refKey: `payout:${opts.payoutId}`,
  });
}

export async function notifyCustomization(opts: {
  shop: string;
  vendorId: string;
  orderName: string;
  attributionId: string;
}) {
  return createVendorNotification({
    shop: opts.shop,
    vendorId: opts.vendorId,
    type: "customization",
    title: `Customization request — ${opts.orderName}`,
    body: "A customer submitted a customization / design request.",
    href: "/vendor/customized",
    refKey: `custom:${opts.attributionId}`,
  });
}
