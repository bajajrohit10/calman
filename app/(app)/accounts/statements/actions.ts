"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CloseState } from "./close-state";

/**
 * §50G.3. Closing a vendor's month.
 *
 * Two steps, deliberately. "Ready" freezes the numbers and is reversible in
 * the sense that a correction makes a new version; "paid" records that money
 * left, which is not reversible at all and therefore requires a statement to
 * already exist.
 */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const money = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export async function markReady(_p: CloseState, form: FormData): Promise<CloseState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const vendorId = str(form, "vendor_id");
  const month = str(form, "month");
  const note = str(form, "change_note") || null;
  if (!vendorId || !month) return { ok: false, error: "Missing vendor or month.", message: null };

  // §50G.3. A re-snapshot is a correction to something already sent, so it has
  // to say why. The first version does not: nothing has changed yet.
  const { data: existing } = await supabase
    .schema("accounts").from("statements")
    .select("version").eq("vendor_id", vendorId).eq("month", `${month}-01`)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (existing && !note) {
    return {
      ok: false,
      error: "This month is already final. Re-issuing it needs a note saying what changed.",
      message: null,
    };
  }

  const { data, error } = await supabase
    .schema("accounts").rpc("mark_vendor_ready", {
      p_vendor_id: vendorId, p_month: `${month}-01`,
      // The generator types a defaulted argument as optional, never nullable;
      // the function itself takes null happily and means "no note".
      p_change_note: note ?? undefined,
    });
  if (error) return { ok: false, error: error.message, message: null };

  const s = data as {
    version: number; lines_marked_ready: number; line_count: number;
    total_remittance: number; net_payable: number;
  };
  revalidatePath("/accounts/statements");
  revalidatePath("/accounts");
  revalidatePath("/accounts/sales");
  return {
    ok: true, error: null,
    message: `Version ${s.version} issued: ${s.line_count} line(s), ` +
      `${s.lines_marked_ready} moved to ready, net ${money(s.net_payable)}.`,
  };
}

export async function markPaid(_p: CloseState, form: FormData): Promise<CloseState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const vendorId = str(form, "vendor_id");
  const month = str(form, "month");
  const paidOn = str(form, "paid_on");
  const reference = str(form, "reference");
  if (!vendorId || !month) return { ok: false, error: "Missing vendor or month.", message: null };
  if (!paidOn) return { ok: false, error: "Enter the date the money went.", message: null };
  if (!reference) return { ok: false, error: "Enter a payment reference.", message: null };

  const { data, error } = await supabase
    .schema("accounts").rpc("mark_vendor_paid", {
      p_vendor_id: vendorId, p_month: `${month}-01`,
      p_paid_on: paidOn, p_reference: reference,
    });
  if (error) return { ok: false, error: error.message, message: null };

  const s = data as { lines_marked_paid: number };
  revalidatePath("/accounts/statements");
  revalidatePath("/accounts");
  revalidatePath("/accounts/sales");
  return {
    ok: true, error: null,
    message: `Recorded as paid on ${paidOn}; ${s.lines_marked_paid} line(s) now paid.`,
  };
}
