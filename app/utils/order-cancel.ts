export const ORDER_CANCEL_REASONS = [
  { value: "CUSTOMER", label: "Customer changed / cancelled" },
  { value: "INVENTORY", label: "Items unavailable" },
  { value: "DECLINED", label: "Payment declined" },
  { value: "FRAUD", label: "Fraudulent order" },
  { value: "STAFF", label: "Staff error" },
  { value: "OTHER", label: "Other" },
] as const;

export type OrderCancelReason =
  (typeof ORDER_CANCEL_REASONS)[number]["value"];
