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
export const LINE_STATUSES = [
  "draft", "ready", "paid", "disputed", "deferred", "cancelled",
] as const;
export const NO_REMITTANCE_REASONS = [
  "cancelled", "serial_key", "replacement", "internal", "other",
] as const;

export type RateSource = (typeof RATE_SOURCES)[number];
export type LineStatus = (typeof LINE_STATUSES)[number];
export type NoRemittanceReason = (typeof NO_REMITTANCE_REASONS)[number];

/**
 * §50H.4 / §6.1. The sales tabs, by how the vendor gets paid.
 *
 * "Unassigned" exists because the first four did not add up: a line whose
 * vendor never resolved has no payment mode, so it appeared only under All and
 * the tab counts were quietly short of the total. A tab that holds them is
 * better than a discrepancy nobody can explain.
 */
export const SALES_TABS = [
  { id: "online", label: "Online payments", mode: "online_instant" },
  { id: "portal", label: "Portal", mode: "portal_balance" },
  { id: "sheet", label: "Google sheet", mode: "later" },
  { id: "unassigned", label: "Unassigned", mode: null },
  { id: "all", label: "All", mode: null },
] as const;

/** Rows a tab shows. `all` is everything; `unassigned` is the modeless ones. */
export function tabMatches(tab: SalesTab, paymentMode: string | null): boolean {
  if (tab === "all") return true;
  if (tab === "unassigned") return paymentMode === null;
  return paymentMode === (SALES_TABS.find((t) => t.id === tab)?.mode ?? null);
}

export type SalesTab = (typeof SALES_TABS)[number]["id"];
