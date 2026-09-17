"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ReconActionState } from "./recon-state";

/**
 * §50F.3-4. The three writes this screen owns.
 *
 * Marking a payment reviewed, and learning a portal price. The two inline
 * corrections on a line — override % and no-remittance reason — are the ones
 * from /accounts/sales and are imported from there rather than reimplemented,
 * so a rule about how remittance is computed lives in one place.
 */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Somebody has looked at this payment and is content with it. */
export async function setReviewed(
  _p: ReconActionState, form: FormData,
): Promise<ReconActionState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const ids = String(form.get("payment_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return { ok: false, error: "No payment on this row to review.", message: null };

  const { error } = await supabase
    .schema("accounts").from("payments")
    .update({ reviewed: str(form, "reviewed") !== "0", review_note: str(form, "note") || null })
    .in("id", ids);
  if (error) return { ok: false, error: error.message, message: null };

  revalidatePath("/accounts/reconcile");
  return { ok: true, error: null, message: `${ids.length} payment(s) marked.` };
}

/**
 * §50F.4. Save the price the payment implies, and rebase the month.
 *
 * §50H.2 removed the centre branch: a centre base is computed from the
 * vendor's arrangement, never learned from one payment.
 *
 * The rebase is the point: a portal price is a property of the product, so the
 * one order that revealed it is not the only line that was mis-based. The
 * function does the whole thing in one statement and reports how many lines
 * moved.
 */
export async function savePortalPrice(
  _p: ReconActionState, form: FormData,
): Promise<ReconActionState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const lineId = str(form, "line_id");
  const price = Number(str(form, "price"));
  if (!lineId) return { ok: false, error: "No line.", message: null };
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "The implied price is not a usable number.", message: null };
  }

  const { data, error } = await supabase
    .schema("accounts").rpc("save_portal_price", {
      p_line_id: lineId, p_price: price,
    });
  if (error) return { ok: false, error: error.message, message: null };

  const s = data as { price: number; lines_rebased: number };
  revalidatePath("/accounts/reconcile");
  revalidatePath("/accounts/sales");
  return {
    ok: true, error: null,
    message: `Saved ₹${s.price}; ${s.lines_rebased} line(s) rebased.`,
  };
}
