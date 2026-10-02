/** Shared helpers for order-note URLs / custom design images */

export function findUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'\)\]|]+/gi) || [];
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
