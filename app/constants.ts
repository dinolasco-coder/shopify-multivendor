export const VENDOR_METAFIELD_NAMESPACE = "marketplace";
export const VENDOR_METAFIELD_KEY = "vendor_id";

/** Metafield value for products created by the shop admin (not a seller). */
export const ADMIN_STORE_VENDOR_ID = "__admin__";

/** App-owned metafield namespace key used in Admin GraphQL ($app:marketplace) */
export const VENDOR_METAFIELD_NAMESPACE_APP = "$app:marketplace";

export const VENDOR_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "suspended",
] as const;

export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_SESSION_COOKIE = "mv_vendor_session";
export const VENDOR_SESSION_DAYS = 14;
