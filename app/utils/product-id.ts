/** Convert Shopify product GID to a URL-safe numeric path segment. */
export function toProductPathId(gid: string): string {
  const match = gid.match(/Product\/(\d+)/);
  return match?.[1] || gid;
}

/** Rebuild Shopify product GID from a path segment. */
export function fromProductPathId(pathId: string): string {
  if (pathId.startsWith("gid://")) return pathId;
  return `gid://shopify/Product/${pathId}`;
}
