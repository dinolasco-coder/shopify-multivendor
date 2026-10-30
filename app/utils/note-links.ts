/** Shared helpers for order-note URLs / custom design images */

export function findUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'|)]+/gi) || [];
  return found.map((raw) => raw.replace(/[.,;:!?]+$/g, ""));
}

export function isImageUrl(url: string) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path);
  } catch {
    return false;
  }
}

export function findImageUrls(text: string): string[] {
  return findUrls(text).filter(isImageUrl);
}

/** Shopify CDN and common upload paths without a file extension in the URL. */
export function isLikelyDesignAssetUrl(url: string): boolean {
  if (isImageUrl(url)) return true;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.includes("cdn.shopify.com") && (path.includes("/files/") || path.includes("/products/"))) {
      return true;
    }
    if (
      /\/uploads?\//i.test(path) ||
      /\/design/i.test(path) ||
      /\/custom/i.test(path)
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Image URLs from notes, checkout attributes, and line-item properties. */
export function findDesignImageUrls(...texts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    const raw = (text || "").trim();
    if (!raw) continue;
    for (const url of findImageUrls(raw)) seen.add(url);
    for (const url of findUrls(raw)) {
      if (isLikelyDesignAssetUrl(url)) seen.add(url);
    }
  }
  return [...seen];
}

export type OrderCustomizationInput = {
  note?: string | null;
  customAttributes?: Array<{ key?: string | null; value?: string | null }> | null;
  lineItems?: {
    nodes?: Array<{
      id?: string | null;
      customAttributes?: Array<{ key?: string | null; value?: string | null }> | null;
    }> | null;
  } | null;
};

/**
 * Build customer note + design URLs from order note, cart attributes, and line items.
 * When lineItemIds is set, only those lines contribute line-level attributes.
 */
export function extractCustomizationFromOrder(
  order: OrderCustomizationInput,
  options?: { lineItemIds?: string[] },
): { customerNote: string; imageUrls: string[] } | null {
  const lineSet = options?.lineItemIds?.length
    ? new Set(options.lineItemIds)
    : null;
  const noteParts: string[] = [];

  if (order.note?.trim()) noteParts.push(order.note.trim());

  for (const attr of order.customAttributes ?? []) {
    const value = String(attr.value ?? "").trim();
    if (!value) continue;
    const key = String(attr.key ?? "Detail").trim();
    noteParts.push(`${key}: ${value}`);
  }

  for (const line of order.lineItems?.nodes ?? []) {
    if (lineSet && line.id && !lineSet.has(line.id)) continue;
    for (const attr of line.customAttributes ?? []) {
      const value = String(attr.value ?? "").trim();
      if (!value) continue;
      const key = String(attr.key ?? "Line item").trim();
      noteParts.push(`${key}: ${value}`);
    }
  }

  const customerNote = noteParts.join("\n\n");
  const imageUrls = findDesignImageUrls(customerNote);
  if (!imageUrls.length) return null;

  return { customerNote, imageUrls };
}
