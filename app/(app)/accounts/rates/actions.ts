"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { OverrideState } from "./form-state";

/**
 * §50B.2. Writes behind the Rates screen.
 *
 * Every one of these re-checks the role. requireAccountsProfile() guards the
 * page, but a server action is its own endpoint and can be called without ever
 * rendering the page it belongs to, so guarding the render guards nothing.
 */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function parsePct(raw: string): number | string {
  if (!raw) return "Enter a percentage.";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return "Percentage must be a number with at most two decimals.";
  const n = Number(raw);
  if (n < 0 || n > 100) return "Percentage must be between 0 and 100.";
  return n;
}

/**
 * §50C(c). Put a real percentage on a seeded row.
 *
 * The primary way a flagged cell gets resolved: the August figure is in the
 * note, somebody decides whether it is the agreed rate, and types it. Writing
 * a percentage is what clears needs_review — the flag means "no human has
 * confirmed a number here", so a human confirming a number is exactly what
 * should end it.
 */
export async function updateRatePct(
  _prev: OverrideState,
  form: FormData,
): Promise<OverrideState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const id = str(form, "id");
  if (!id) return { ok: false, error: "Missing rate row." };
  const pct = parsePct(str(form, "pct"));
  if (typeof pct === "string") return { ok: false, error: pct };

  const { error } = await supabase
    .schema("accounts")
    .from("rate_grid")
    .update({ pct, needs_review: false })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/accounts/rates");
  return { ok: true, error: null };
}


/**
 * Set a percentage on one unresolved line.
 *
 * rate_source becomes 'line_override', which takes it out of the Unknown tab
 * and records that a person decided this, not a table. The remittance itself
 * is not recalculated here — that belongs with the import, which owns
 * base_amount and is the only place that knows what to multiply.
 */
export async function setLineOverride(
  _prev: OverrideState,
  form: FormData,
): Promise<OverrideState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const id = str(form, "id");
  if (!id) return { ok: false, error: "Missing line." };
  const pct = parsePct(str(form, "override_pct"));
  if (typeof pct === "string") return { ok: false, error: pct };
  const note = str(form, "override_note") || null;

  const { error } = await supabase
    .schema("accounts")
    .from("sales_lines")
    .update({ override_pct: pct, override_note: note, rate_source: "line_override" })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/accounts/rates");
  return { ok: true, error: null };
}
