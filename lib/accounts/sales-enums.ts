/**
 * §50E.3. The enumerations the sales screen shares with its client components.
 *
 * Separate from sales.ts because that module is "server-only" — it opens a
 * Supabase server client — and the inline action components are client-side.
 * Importing the constants from there would drag the server module into the
 * browser bundle, which fails the build rather than leaking, but the fix is
 * the same either way: values that both sides need belong in a module that
 * neither side owns.
 *
 * These mirror the check constraints in migration 125. They are not generated
 * from them, so a constraint that changes has to change here too.
 */

export const RATE_SOURCES = ["grid", "combo", "state_rule", "line_override", "none"] as const;
export const LINE_STATUSES = ["draft", "ready", "paid", "disputed", "deferred"] as const;
export const NO_REMITTANCE_REASONS = [
  "cancelled", "serial_key", "replacement", "internal", "other",
] as const;

export type RateSource = (typeof RATE_SOURCES)[number];
export type LineStatus = (typeof LINE_STATUSES)[number];
export type NoRemittanceReason = (typeof NO_REMITTANCE_REASONS)[number];
