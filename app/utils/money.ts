export const DEFAULT_CURRENCY = "PHP";

export function formatMoney(amount: number, currency = DEFAULT_CURRENCY) {
  const code = currency || DEFAULT_CURRENCY;
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `₱${amount.toFixed(2)}`;
  }
}
