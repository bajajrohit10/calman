/**
 * §50G.1(a). Adjustment reasons, shared with client components.
 *
 * Outside statements.ts because that module is "server-only" — the same split
 * as sales-enums.ts, for the same reason: a value both sides need belongs in a
 * module neither side owns.
 */
export const ADJUSTMENT_REASONS = [
  "refund_deduction", "cancellation_charge", "price_correction",
  "prior_month_correction", "other",
] as const;

export const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  refund_deduction: "Refund deduction",
  cancellation_charge: "Cancellation charge",
  price_correction: "Price correction",
  prior_month_correction: "Prior month correction",
  other: "Other",
};

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
