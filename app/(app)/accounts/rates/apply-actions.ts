"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { istToday } from "@/lib/format";
import { LEVELS, PRODUCT_TYPES } from "@/lib/accounts/rates";
import { SALE_KINDS, type SaleKind } from "@/lib/accounts/classify";
import type { ApplyState } from "./apply-state";

/**
 * §50H.3. Apply one percentage to many cells at once.
 *
 * Setting a vendor's commission was a form per cell, which for a vendor with
 * nine cells meant nine identical forms. It is one number for the whole
 * vendor far more often than not, so the panel applies it across every cell
 * selected and the per-cell forms are gone.
 *
 * The retrospective guard runs once for the batch with the counts summed,
 * rather than once per cell: the question "how many settled lines does this
 * disturb" is about the act, not about each row of it.
 */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function parsePct(raw: string): number | string {
  if (!raw) return "Enter a percentage.";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return "Percentage must be a number with at most two decimals.";
  const n = Number(raw);
  if (n < 0 || n > 100) return "Percentage must be between 0 and 100.";
  return n;
}

type Cell = { level: string; product_type: string };

function parseCells(form: FormData): Cell[] | string {
  const raw = form.getAll("cell").map(String).filter(Boolean);
  const cells: Cell[] = [];
  for (const c of raw) {
    const [level, productType] = c.split("|");
    if (!(LEVELS as readonly string[]).includes(level)) return `Unknown level "${level}".`;
    if (!(PRODUCT_TYPES as readonly string[]).includes(productType)) return `Unknown type "${productType}".`;
    cells.push({ level, product_type: productType });
  }
  if (!cells.length) return "Choose at least one cell.";
  return cells;
}

export async function applyRate(_prev: ApplyState, form: FormData): Promise<ApplyState> {
  const { profile } = await requireAccountsProfile();
  const supabase = await createClient();

  const vendorId = str(form, "vendor_id");
  const saleKind = str(form, "sale_kind") as SaleKind;
  const from = str(form, "effective_from") || istToday();
  const language = str(form, "language") === "english" ? "english" : null;
  const confirmed = str(form, "confirmed") === "1";

  if (!vendorId) return { ok: false, error: "Pick a vendor first.", confirm: null, message: null };
  if (!(SALE_KINDS as readonly string[]).includes(saleKind)) {
    return { ok: false, error: "Unknown sale kind.", confirm: null, message: null };
  }
  const pct = parsePct(str(form, "pct"));
  if (typeof pct === "string") return { ok: false, error: pct, confirm: null, message: null };
  const cells = parseCells(form);
  if (typeof cells === "string") return { ok: false, error: cells, confirm: null, message: null };

  // The guard, once for the whole batch.
  if (from < istToday() && !confirmed) {
    let paid = 0, ready = 0;
    for (const c of cells) {
      const { data } = await supabase.schema("accounts").rpc("retro_line_counts", {
        p_vendor_id: vendorId, p_level: c.level, p_product_type: c.product_type,
        p_is_combo: saleKind === "combo", p_from: from, p_to: undefined as unknown as string,
      });
      const row = (Array.isArray(data) ? data[0] : data) as
        { paid_count: number; ready_count: number } | undefined;
      paid += Number(row?.paid_count ?? 0);
      ready += Number(row?.ready_count ?? 0);
    }
    return {
      ok: false, error: null, message: null,
      confirm: {
        paid, ready, from, cells,
        pct: String(pct), language, sale_kind: saleKind,
      },
    };
  }

  const rows = cells.map((c) => ({
    vendor_id: vendorId, sale_kind: saleKind, level: c.level, product_type: c.product_type,
    pct, effective_from: from, effective_to: null, state_scope: null,
    language, note: null, created_by: profile.id,
  }));

  const { error } = await supabase.schema("accounts").from("rate_grid").insert(rows);
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false, confirm: null, message: null,
        error: "One of these cells already has a rate starting on that date. " +
               "Use a different date, or edit the existing rate inline.",
      };
    }
    return { ok: false, error: error.message, confirm: null, message: null };
  }

  // §50H.3. A real percentage on a cell answers whatever the seeder flagged.
  await supabase.schema("accounts").from("rate_grid")
    .update({ needs_review: false })
    .eq("vendor_id", vendorId).eq("sale_kind", saleKind)
    .eq("needs_review", true).gt("pct", 0)
    .in("level", cells.map((c) => c.level))
    .in("product_type", cells.map((c) => c.product_type));

  revalidatePath("/accounts/rates");
  return {
    ok: true, error: null, confirm: null,
    message: `${rows.length} rate${rows.length === 1 ? "" : "s"} set at ${pct}% from ${from}.`,
  };
}

/**
 * §50H.3. Inline edit of a cell's current percentage.
 *
 * Writes a new row rather than changing the old one — the history is the point
 * — and end-dates a 0% placeholder it supersedes so that period stays
 * honestly uncovered rather than silently paying nothing.
 */
export async function editCellPct(_prev: ApplyState, form: FormData): Promise<ApplyState> {
  const { profile } = await requireAccountsProfile();
  const supabase = await createClient();

  const vendorId = str(form, "vendor_id");
  const saleKind = str(form, "sale_kind") as SaleKind;
  const level = str(form, "level");
  const productType = str(form, "product_type");
  const language = str(form, "language") === "english" ? "english" : null;
  const from = str(form, "effective_from") || istToday();
  const pct = parsePct(str(form, "pct"));
  if (typeof pct === "string") return { ok: false, error: pct, confirm: null, message: null };
  if (!vendorId || !level || !productType) {
    return { ok: false, error: "Missing cell.", confirm: null, message: null };
  }

  // A new row per edit, so the history survives — except when a row already
  // starts on this date, which is the row being edited. Inserting a second one
  // is impossible (the unique index says so) and would be meaningless anyway:
  // two rates for the same cell from the same day is not a history, it is a
  // contradiction. So that case updates in place.
  const existing = await supabase
    .schema("accounts").from("rate_grid")
    .select("id")
    .eq("vendor_id", vendorId).eq("sale_kind", saleKind)
    .eq("level", level).eq("product_type", productType)
    .eq("effective_from", from)
    .is("state_scope", null)
    .filter("language", language === null ? "is" : "eq", language === null ? null : language)
    .maybeSingle();

  const { error } = existing.data
    ? await supabase.schema("accounts").from("rate_grid")
        .update({ pct, needs_review: false }).eq("id", existing.data.id)
    : await supabase.schema("accounts").from("rate_grid").insert({
        vendor_id: vendorId, sale_kind: saleKind, level, product_type: productType,
        pct, effective_from: from, effective_to: null, state_scope: null,
        language, created_by: profile.id,
      });
  if (error) return { ok: false, error: error.message, confirm: null, message: null };

  const dayBefore = new Date(`${from}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  await supabase.schema("accounts").from("rate_grid")
    .update({ effective_to: dayBefore.toISOString().slice(0, 10) })
    .eq("vendor_id", vendorId).eq("sale_kind", saleKind)
    .eq("level", level).eq("product_type", productType)
    .eq("needs_review", true).eq("pct", 0)
    .lt("effective_from", from)
    .or(`effective_to.is.null,effective_to.gte.${from}`);

  revalidatePath("/accounts/rates");
  return { ok: true, error: null, confirm: null, message: `${level} ${productType} set to ${pct}%.` };
}
