"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { WalletState } from "./form-state";

/**
 * §50G.1(b). Ledger entries a person types.
 *
 * Deductions are not here — those are written by the payment import, because a
 * deduction somebody forgets to enter is a balance that reads high for a
 * month. What a person adds is the money going in, and the corrections.
 *
 * Amounts are stored signed so that the balance view is a plain running sum:
 * top-ups positive, deductions negative, adjustments either way.
 */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function addEntry(form: FormData, kind: "opening" | "top_up" | "adjustment"): Promise<WalletState> {
  const { profile } = await requireAccountsProfile();
  const supabase = await createClient();

  const vendorId = str(form, "vendor_id");
  const date = str(form, "entry_date");
  const raw = str(form, "amount");
  if (!vendorId) return { ok: false, error: "Missing wallet.", message: null };
  if (!date) return { ok: false, error: "Enter a date.", message: null };
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    return { ok: false, error: "Amount must be a number.", message: null };
  }
  const amount = Number(raw);
  if (kind !== "adjustment" && amount <= 0) {
    return { ok: false, error: "An opening balance or top-up must be positive.", message: null };
  }

  // §50G.1(b). An opening balance is typed once. A second one would silently
  // double the wallet, and the running sum would give no sign of it.
  if (kind === "opening") {
    const { count } = await supabase
      .schema("accounts").from("portal_ledger")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId).eq("kind", "opening");
    if ((count ?? 0) > 0) {
      return { ok: false, error: "This wallet already has an opening balance.", message: null };
    }
  }

  const { error } = await supabase
    .schema("accounts").from("portal_ledger")
    .insert({
      vendor_id: vendorId, entry_date: date, kind, amount,
      note: str(form, "note") || null,
      order_id: str(form, "reference") || null,
      created_by: profile.id,
    });
  if (error) return { ok: false, error: error.message, message: null };

  revalidatePath("/accounts/wallets");
  revalidatePath("/accounts/statements");
  return { ok: true, error: null, message: `${kind.replace("_", " ")} of ₹${amount} recorded.` };
}

export async function addOpening(_p: WalletState, form: FormData) { return addEntry(form, "opening"); }
export async function addTopUp(_p: WalletState, form: FormData) { return addEntry(form, "top_up"); }
export async function addWalletAdjustment(_p: WalletState, form: FormData) { return addEntry(form, "adjustment"); }
