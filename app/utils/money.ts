export const DEFAULT_CURRENCY = "PHP";

export function formatMoney(amount: number, _currency = DEFAULT_CURRENCY) {
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
    }).format(amount);
  } catch {
    return `₱${amount.toFixed(2)}`;
  }
}
