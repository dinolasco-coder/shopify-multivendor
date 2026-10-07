export const VENDOR_METAFIELD_NAMESPACE = "marketplace";
export const VENDOR_METAFIELD_KEY = "vendor_id";

/** App-owned metafield namespace key used in Admin GraphQL ($app:marketplace) */
export const VENDOR_METAFIELD_NAMESPACE_APP = "$app:marketplace";

/** Store-defined product metafield: AI customization fee (Decimal) */
export const AI_CUSTOMIZATION_FEE_NAMESPACE = "custom";
export const AI_CUSTOMIZATION_FEE_KEY = "ai_customization_fee";
export const AI_CUSTOMIZATION_FEE_TYPE = "number_decimal";

export const VENDOR_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "suspended",
] as const;

export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_SESSION_COOKIE = "mv_vendor_session";
export const VENDOR_SESSION_DAYS = 14;
