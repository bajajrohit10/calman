"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { istToday } from "@/lib/format";
import { normaliseKey } from "@/lib/accounts/normalise-key";
import { LEVELS, PRODUCT_TYPES, STATES } from "@/lib/accounts/rates";
import type { ComboFormState, OverrideState, RateFormState } from "./form-state";

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
 * Add a rate_grid row.
 *
 * Two-pass by design. The first submit of a back-dated rate returns a confirm
 * block instead of saving; the client shows what it would touch and submits
 * again with `confirmed`. That keeps the count and the warning on the server,
 * where they cannot be skipped by posting the form directly.
 */
export async function addRate(
  _prev: RateFormState,
  form: FormData,
): Promise<RateFormState> {
  const { profile } = await requireAccountsProfile();
  const supabase = await createClient();

  const vendorId = str(form, "vendor_id");
  const level = str(form, "level");
  const productType = str(form, "product_type");
  const from = str(form, "effective_from");
  const to = str(form, "effective_to") || null;
  const note = str(form, "note") || null;
  const states = form.getAll("state_scope").map(String).filter(Boolean);
  const confirmed = str(form, "confirmed") === "1";

  if (!vendorId) return { ok: false, error: "Pick a vendor first.", confirm: null };
  if (!(LEVELS as readonly string[]).includes(level))
    return { ok: false, error: "Choose a level.", confirm: null };
  if (!(PRODUCT_TYPES as readonly string[]).includes(productType))
    return { ok: false, error: "Choose a type.", confirm: null };
  if (!from) return { ok: false, error: "Effective from is required.", confirm: null };
  if (to && to < from)
    return { ok: false, error: "Effective to cannot be before effective from.", confirm: null };

  const bad = states.find((s) => !(STATES as readonly string[]).includes(s));
  if (bad) return { ok: false, error: `Unknown state "${bad}".`, confirm: null };

  const pct = parsePct(str(form, "pct"));
  if (typeof pct === "string") return { ok: false, error: pct, confirm: null };

  // The retrospective guard. Counted every time, shown only when the rate
  // reaches backwards and the user has not already looked at the numbers.
  if (from < istToday() && !confirmed) {
    const { data, error } = await supabase
      .schema("accounts")
      .rpc("retro_line_counts", {
        p_vendor_id: vendorId, p_level: level,
        p_product_type: productType, p_from: from,
        // p_to is nullable in SQL and null is the meaningful value — an
        // open-ended rate, everything from p_from onwards. The type generator
        // has no way to say "nullable argument" and emits a bare string, so
        // the cast is here rather than a default in the function, which would
        // have changed what an omitted argument means.
        p_to: to as string,
      });
    if (error) return { ok: false, error: error.message, confirm: null };
    const row = (Array.isArray(data) ? data[0] : data) as
      | { paid_count: number; ready_count: number }
      | undefined;
    return {
      ok: false,
      error: null,
      confirm: {
        paid: Number(row?.paid_count ?? 0),
        ready: Number(row?.ready_count ?? 0),
        from, to,
        // Echoed back because the form's own fields are reset by the time the
        // user sees this, so the confirm has to carry the values rather than
        // re-read them.
        values: {
          level, product_type: productType, pct: String(pct),
          effective_from: from, effective_to: to, note,
          state_scope: states,
        },
      },
    };
  }

  const { error } = await supabase
    .schema("accounts")
    .from("rate_grid")
    .insert({
      vendor_id: vendorId, level, product_type: productType, pct,
      effective_from: from, effective_to: to,
      // null, not [], means "every state" — an empty array would mean no
      // states at all, which is a rate that can never apply.
      state_scope: states.length ? states : null,
      note, created_by: profile.id,
    });

  if (error) {
    if (error.code === "23505")
      return {
        ok: false,
        error: "A rate already starts on that date for this cell and state scope. Use a different start date.",
        confirm: null,
      };
    return { ok: false, error: error.message, confirm: null };
  }

  revalidatePath("/accounts/rates");
  return { ok: true, error: null, confirm: null };
}

export async function addCombo(
  _prev: ComboFormState,
  form: FormData,
): Promise<ComboFormState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const vendorId = str(form, "vendor_id");
  const title = str(form, "display_title");
  // The typed key wins if the user edited it; otherwise derive it from the
  // title with the same normaliser the importer uses.
  const key = str(form, "combo_key") || normaliseKey(title) || "";
  const from = str(form, "effective_from");
  const to = str(form, "effective_to") || null;
  const note = str(form, "note") || null;

  if (!vendorId) return { ok: false, error: "Choose the vendor this combo is paid to." };
  if (!title) return { ok: false, error: "Enter the combo title." };
  if (!key) return { ok: false, error: "The combo key cannot be empty." };
  if (!from) return { ok: false, error: "Effective from is required." };
  if (to && to < from) return { ok: false, error: "Effective to cannot be before effective from." };

  const pct = parsePct(str(form, "pct"));
  if (typeof pct === "string") return { ok: false, error: pct };

  const { error } = await supabase
    .schema("accounts")
    .from("combo_rates")
    .insert({
      vendor_id: vendorId, combo_key: key, display_title: title,
      pct, effective_from: from, effective_to: to, note,
    });

  if (error) {
    if (error.code === "23505")
      return { ok: false, error: `A combo rate for "${key}" already starts on ${from}.` };
    return { ok: false, error: error.message };
  }

  revalidatePath("/accounts/rates");
  return { ok: true, error: null };
}

/** End-date a combo rather than delete it: the old rate is still the record. */
export async function endCombo(form: FormData): Promise<void> {
  await requireAccountsProfile();
  const supabase = await createClient();
  const id = str(form, "id");
  const to = str(form, "effective_to");
  if (!id || !to) return;
  await supabase
    .schema("accounts")
    .from("combo_rates")
    .update({ effective_to: to })
    .eq("id", id);
  revalidatePath("/accounts/rates");
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
