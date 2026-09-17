"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NO_REMITTANCE_REASONS } from "@/lib/accounts/sales-enums";

/**
 * §50E.3. Inline corrections on a sales line.
 *
 * Each of these re-runs the arithmetic rather than trusting a number from the
 * form, and each is audited by the z_audit_sales_lines trigger, so what the
 * screen changed is recoverable from the audit log without the actions having
 * to write their own history.
 *
 * The formula lives here and in accounts.commit_sales_batch. It is four terms
 * long and copying it is less risky than a round trip to change one line, but
 * they have to move together: remittance = base × (1 − pct/100).
 */

import type { LineActionState } from "./line-state";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function parsePct(raw: string): number | string {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return "Percentage must be a number with at most two decimals.";
  const n = Number(raw);
  if (n < 0 || n > 100) return "Percentage must be between 0 and 100.";
  return n;
}

const remittance = (base: number, pct: number) =>
  Math.round(base * (1 - pct / 100) * 100) / 100;

async function lineOf(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .schema("accounts").from("sales_lines")
    .select("id, vendor_id, level, product_type, is_combo, order_date, state, base_amount, status, no_remittance_reason")
    .eq("id", id).maybeSingle();
  return data;
}

/** Re-ask the grid for this line's rate. Used after the vendor changes. */
async function resolveFor(line: {
  vendor_id: string | null; level: string | null; product_type: string | null;
  is_combo: boolean; order_date: string | null; state: string | null;
}) {
  const supabase = await createClient();
  if (!line.vendor_id || !line.level || !line.product_type || !line.order_date) {
    return { pct: null as number | null, source: "none", id: null as string | null };
  }
  const ist = new Date(line.order_date);
  ist.setUTCMinutes(ist.getUTCMinutes() + 330);
  const { data } = await supabase.schema("accounts").rpc("resolve_rate", {
    p_vendor_id: line.vendor_id,
    p_level: line.level,
    p_product_type: line.product_type,
    p_is_combo: line.is_combo,
    p_order_date: ist.toISOString().slice(0, 10),
    p_state: line.state as string,
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    { pct: number | null; source: string; rate_id: string | null } | undefined;
  return {
    pct: row?.pct === null || row?.pct === undefined ? null : Number(row.pct),
    source: row?.source ?? "none",
    id: row?.rate_id ?? null,
  };
}

export async function changeVendor(
  _p: LineActionState, form: FormData,
): Promise<LineActionState> {
  await requireAccountsProfile();
  const supabase = await createClient();
  const id = str(form, "id");
  const vendorId = str(form, "vendor_id") || null;
  if (!id) return { ok: false, error: "Missing line." };

  const line = await lineOf(id);
  if (!line) return { ok: false, error: "Line not found." };

  const r = await resolveFor({ ...line, vendor_id: vendorId } as Parameters<typeof resolveFor>[0]);
  const base = Number(line.base_amount ?? 0);
  const dead = line.status === "cancelled" || line.status === "deferred" || line.no_remittance_reason;
  const { data: vendor } = await supabase
    .schema("accounts").from("vendors").select("default_payment_mode").eq("id", vendorId ?? "").maybeSingle();

  const { error } = await supabase
    .schema("accounts").from("sales_lines")
    .update({
      vendor_id: vendorId,
      rate_pct: r.pct, rate_source: r.source,
      override_pct: null, override_note: null,
      calculated_remittance: dead || r.pct === null ? 0 : remittance(base, r.pct),
      payment_mode: vendor?.default_payment_mode ?? null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accounts/sales");
  revalidatePath("/accounts/rates");
  return { ok: true, error: null };
}

export async function setOverride(
  _p: LineActionState, form: FormData,
): Promise<LineActionState> {
  await requireAccountsProfile();
  const supabase = await createClient();
  const id = str(form, "id");
  if (!id) return { ok: false, error: "Missing line." };
  const pct = parsePct(str(form, "override_pct"));
  if (typeof pct === "string") return { ok: false, error: pct };

  const line = await lineOf(id);
  if (!line) return { ok: false, error: "Line not found." };
  const dead = line.status === "cancelled" || line.status === "deferred" || line.no_remittance_reason;

  const { error } = await supabase
    .schema("accounts").from("sales_lines")
    .update({
      override_pct: pct, override_note: str(form, "override_note") || null,
      rate_pct: pct, rate_source: "line_override",
      calculated_remittance: dead ? 0 : remittance(Number(line.base_amount ?? 0), pct),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accounts/sales");
  revalidatePath("/accounts/rates");
  return { ok: true, error: null };
}

/** Drop the override and fall back to whatever the grid says today. */
export async function clearOverride(
  _p: LineActionState, form: FormData,
): Promise<LineActionState> {
  await requireAccountsProfile();
  const supabase = await createClient();
  const id = str(form, "id");
  const line = await lineOf(id);
  if (!line) return { ok: false, error: "Line not found." };

  const r = await resolveFor(line as Parameters<typeof resolveFor>[0]);
  const dead = line.status === "cancelled" || line.status === "deferred" || line.no_remittance_reason;
  const { error } = await supabase
    .schema("accounts").from("sales_lines")
    .update({
      override_pct: null, override_note: null,
      rate_pct: r.pct, rate_source: r.source,
      calculated_remittance: dead || r.pct === null ? 0 : remittance(Number(line.base_amount ?? 0), r.pct),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accounts/sales");
  return { ok: true, error: null };
}

/** Mark a line as earning nothing, and say why. */
export async function setNoRemittance(
  _p: LineActionState, form: FormData,
): Promise<LineActionState> {
  await requireAccountsProfile();
  const supabase = await createClient();
  const id = str(form, "id");
  const reason = str(form, "no_remittance_reason");
  if (!id) return { ok: false, error: "Missing line." };

  if (reason && !(NO_REMITTANCE_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: "Unknown reason." };
  }

  const line = await lineOf(id);
  if (!line) return { ok: false, error: "Line not found." };

  // Clearing the reason puts the money back, so the rate has to be re-read.
  let remit = 0;
  if (!reason) {
    const r = await resolveFor(line as Parameters<typeof resolveFor>[0]);
    remit = r.pct === null || line.status === "cancelled" || line.status === "deferred"
      ? 0 : remittance(Number(line.base_amount ?? 0), r.pct);
  }

  const { error } = await supabase
    .schema("accounts").from("sales_lines")
    .update({
      no_remittance_reason: reason || null,
      override_note: str(form, "note") || null,
      calculated_remittance: remit,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/accounts/sales");
  return { ok: true, error: null };
}
