"use server";

import { revalidatePath } from "next/cache";

import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { VendorEditState } from "./form-state";

/**
 * §6.3. Editing a vendor.
 *
 * The name is deliberately not editable. It is what the sales and payments
 * sheets are matched against every month, so renaming one here would silently
 * stop next month's import from finding it — an alias is how a vendor acquires
 * another spelling, and that is what the alias list below is for.
 *
 * Changing default_payment_mode does not touch existing sales_lines. Their
 * payment_mode was copied at import and is a record of how that month was
 * settled; rewriting history to match a new arrangement would move closed
 * lines between tabs and make a reconciled month disagree with itself.
 */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

const KINDS = ["teacher", "institute", "books", "zeroinfy_internal"];
const MODES = ["portal_balance", "online_instant", "later"];

function money(raw: string): number | null | string {
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return "Amounts must be a number.";
  return Number(raw);
}

export async function updateVendor(
  _p: VendorEditState, form: FormData,
): Promise<VendorEditState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const id = str(form, "id");
  if (!id) return { ok: false, error: "Missing vendor.", message: null };

  const kind = str(form, "kind");
  const mode = str(form, "default_payment_mode");
  if (!KINDS.includes(kind)) return { ok: false, error: "Choose a kind.", message: null };
  if (!MODES.includes(mode)) return { ok: false, error: "Choose a payment mode.", message: null };

  const amount = money(str(form, "center_discount_amount"));
  if (typeof amount === "string") return { ok: false, error: amount, message: null };
  const threshold = money(str(form, "center_discount_threshold"));
  if (typeof threshold === "string") return { ok: false, error: threshold, message: null };

  // Both or neither: a discount with no threshold never fires, and a threshold
  // with no discount is a number that does nothing. Either is a setting
  // somebody will believe is working.
  if ((amount === null) !== (threshold === null)) {
    return {
      ok: false, message: null,
      error: "Set both centre fields or neither — one alone does nothing.",
    };
  }

  const owner = str(form, "portal_owner_vendor_id") || null;
  if (owner === id) {
    return { ok: false, error: "A vendor cannot own its own wallet.", message: null };
  }

  const { error } = await supabase
    .schema("accounts").from("vendors")
    .update({
      institute: str(form, "institute") || null,
      kind,
      default_payment_mode: mode,
      tracks_portal_balance: str(form, "tracks_portal_balance") === "1",
      portal_owner_vendor_id: owner,
      center_discount_amount: amount,
      center_discount_threshold: threshold,
      is_active: str(form, "is_active") === "1",
      note: str(form, "note") || null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message, message: null };

  revalidatePath("/accounts/vendors");
  revalidatePath("/accounts/sales");
  return { ok: true, error: null, message: "Saved." };
}

export async function addAlias(_p: VendorEditState, form: FormData): Promise<VendorEditState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const id = str(form, "id");
  const alias = str(form, "alias");
  if (!id || !alias) return { ok: false, error: "Enter the spelling to add.", message: null };

  // An alias that already points somewhere else would quietly re-route a
  // vendor's sales, so the collision is reported rather than overwritten.
  const { data: taken } = await supabase
    .schema("accounts").from("vendor_aliases")
    .select("vendor_id, vendors ( name )").eq("alias", alias).maybeSingle();
  if (taken) {
    const owner = (taken.vendors as { name: string } | null)?.name ?? "another vendor";
    return { ok: false, message: null, error: `"${alias}" already resolves to ${owner}.` };
  }

  const { error } = await supabase
    .schema("accounts").from("vendor_aliases").insert({ vendor_id: id, alias });
  if (error) return { ok: false, error: error.message, message: null };

  revalidatePath("/accounts/vendors");
  return { ok: true, error: null, message: `"${alias}" added.` };
}

export async function removeAlias(_p: VendorEditState, form: FormData): Promise<VendorEditState> {
  await requireAccountsProfile();
  const supabase = await createClient();

  const aliasId = str(form, "alias_id");
  if (!aliasId) return { ok: false, error: "Missing alias.", message: null };

  const { error } = await supabase
    .schema("accounts").from("vendor_aliases").delete().eq("id", aliasId);
  if (error) return { ok: false, error: error.message, message: null };

  revalidatePath("/accounts/vendors");
  return { ok: true, error: null, message: "Removed." };
}
