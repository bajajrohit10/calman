/**
 * §50B.2. Form state shapes for the Rates screen.
 *
 * Separate from actions.ts because a "use server" module may export only
 * async functions — a plain object export there is a build error, not a
 * lint warning. Types would have been erased and been fine; the initial
 * values are real objects and have to live somewhere else.
 */

export type RateFormState = {
  ok: boolean;
  error: string | null;
  /** Set when a back-dated rate needs the user to look before saving. */
  confirm: { paid: number; ready: number; from: string; to: string | null } | null;
};

export const EMPTY_RATE_STATE: RateFormState = { ok: false, error: null, confirm: null };

export type ComboFormState = { ok: boolean; error: string | null };
export const EMPTY_COMBO_STATE: ComboFormState = { ok: false, error: null };

export type OverrideState = { ok: boolean; error: string | null };
export const EMPTY_OVERRIDE_STATE: OverrideState = { ok: false, error: null };
