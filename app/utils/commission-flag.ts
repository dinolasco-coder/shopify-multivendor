/**
 * Marketplace commission feature switch.
 *
 * - `false` (current): hide commission in admin/seller UI and treat commission as ₱0
 *   so sellers earn the full order subtotal.
 * - `true`: restore commission everywhere.
 *
 * Say **"commission 1"** in chat to turn this back on.
 */
export const COMMISSION_ENABLED = false;

export function effectiveCommissionAmount(amount: number): number {
  if (!COMMISSION_ENABLED) return 0;
  return Number.isFinite(amount) ? amount : 0;
}
