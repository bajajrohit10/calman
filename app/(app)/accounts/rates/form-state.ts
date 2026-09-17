/**
 * §50B.2. Form state shapes for the Rates screen.
 *
 * Separate from actions.ts because a "use server" module may export only
 * async functions — a plain object export there is a build error, not a
 * lint warning. Types would have been erased and been fine; the initial
 * values are real objects and have to live somewhere else.
 */

/**
 * What the server validated, echoed back so the confirming submit carries it.
 *
 * React resets an uncontrolled form after a server action runs, so by the time
 * the retrospective warning is on screen the fields the user typed are already
 * back at their defaults. Re-submitting the form would then save something
 * other than what was counted — a different date, or nothing at all. The
 * confirm step therefore posts these values back as hidden inputs rather than
 * reading the fields again, which also means the numbers in the warning always
 * describe the rate that actually gets saved.
 */
export type RateValues = {
  sale_kind: "single" | "combo";
  level: string;
  product_type: string;
  pct: string;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  state_scope: string[];
};

export type RateFormState = {
  ok: boolean;
  error: string | null;
  /** Set when a back-dated rate needs the user to look before saving. */
  confirm:
    | { paid: number; ready: number; from: string; to: string | null; values: RateValues }
    | null;
};

export const EMPTY_RATE_STATE: RateFormState = { ok: false, error: null, confirm: null };

export type ComboFormState = { ok: boolean; error: string | null };
export const EMPTY_COMBO_STATE: ComboFormState = { ok: false, error: null };

export type OverrideState = { ok: boolean; error: string | null };
export const EMPTY_OVERRIDE_STATE: OverrideState = { ok: false, error: null };
