"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ADJUSTMENT_REASONS } from "@/lib/accounts/adjustment-enums";
import type { AdjState } from "./form-state";

/**
 * §50G.1(a). A manual line on a vendor's month.
 *
 * Signed: negative is a deduction. One column rather than a kind plus a
 * magnitude means the statement total is a plain sum and nobody has to know
 * which reasons subtract.
 */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function addAdjustment(_p: AdjState, form: FormData): Promise<AdjState> {
  const { profile } = await requireAccountsProfile();
  const supabase = await createClient();

  const vendorId = str(form, "vendor_id");
  const month = str(form, "month");
  const reason = str(form, "reason");
  const linked = str(form, "linked_order_id") || null;
  const raw = str(form, "amount");

  if (!vendorId) return { ok: false, error: "Choose a vendor.", message: null };
  if (!month) return { ok: false, error: "Choose a month.", message: null };
  if (!(ADJUSTMENT_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: "Choose a reason.", message: null };
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    return { ok: false, error: "Amount must be a number, negative for a deduction.", message: null };
  }
  const amount = Number(raw);
  if (amount === 0) return { ok: false, error: "An adjustment of zero changes nothing.", message: null };

  // A linked order is a claim about a specific sale, so it is checked rather
  // than trusted: a typo here would attach a deduction to nothing.
  if (linked) {
    const { data } = await supabase
      .schema("accounts").from("sales_lines")
      .select("order_id, vendor_id").eq("order_id", linked).maybeSingle();
    if (!data) return { ok: false, error: `No sales line has order id ${linked}.`, message: null };
    if (data.vendor_id !== vendorId) {
      return { ok: false, error: `Order ${linked} belongs to a different vendor.`, message: null };
    }
  }

  const { error } = await supabase
    .schema("accounts").from("adjustments")
    .insert({
      vendor_id: vendorId, month: `${month}-01`, amount, reason,
      linked_order_id: linked, note: str(form, "note") || null,
      created_by: profile.id,
    });
  if (error) return { ok: false, error: error.message, message: null };

  revalidatePath("/accounts/adjustments");
  revalidatePath("/accounts/statements");
  revalidatePath("/accounts");
  return { ok: true, error: null, message: `Adjustment of ₹${amount} recorded.` };
}

export async function deleteAdjustment(_p: AdjState, form: FormData): Promise<AdjState> {
  await requireAccountsProfile();
  const supabase = await createClient();
  const id = str(form, "id");
  if (!id) return { ok: false, error: "Missing adjustment.", message: null };

  const { error } = await supabase
    .schema("accounts").from("adjustments").delete().eq("id", id);
  if (error) return { ok: false, error: error.message, message: null };

  revalidatePath("/accounts/adjustments");
  revalidatePath("/accounts/statements");
  return { ok: true, error: null, message: "Adjustment removed." };
}
