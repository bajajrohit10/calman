import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The vendor master (§50A.3).
 *
 * A vendor is whoever gets paid: a teacher, the house they teach under, a
 * books arm, or Zeroinfy itself for the lines it keeps. The four kinds behave
 * differently enough at remittance time — a books arm has its own rate, an
 * institute owns a wallet several teachers draw on — that they are one table
 * with a kind rather than four tables that would need joining on every screen.
 */
export type VendorRow = {
  id: string;
  name: string;
  institute: string | null;
  kind: "teacher" | "institute" | "books" | "zeroinfy_internal";
  default_payment_mode: "portal_balance" | "online_instant" | "later";
  tracks_portal_balance: boolean;
  portal_owner_vendor_id: string | null;
  /** Resolved for display: the wallet this vendor's sales are settled through. */
  portal_owner_name: string | null;
  opening_balance: number;
  opening_balance_date: string | null;
  is_active: boolean;
  note: string | null;
  alias_count: number;
};

export type VendorFilters = { kind?: string | null; institute?: string | null };

export async function loadVendors(
  filters: VendorFilters = {},
): Promise<{ rows: VendorRow[]; error: string | null }> {
  const supabase = await createClient();

  let q = supabase
    .schema("accounts")
    .from("vendors")
    .select(
      `id, name, institute, kind, default_payment_mode, tracks_portal_balance,
       portal_owner_vendor_id, opening_balance, opening_balance_date, is_active, note,
       owner:portal_owner_vendor_id ( name ),
       vendor_aliases ( id )`,
    )
    .order("name");

  if (filters.kind) q = q.eq("kind", filters.kind);
  if (filters.institute) q = q.eq("institute", filters.institute);

  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };

  const rows = (data ?? []).map((v) => ({
    id: v.id as string,
    name: v.name as string,
    institute: v.institute as string | null,
    kind: v.kind as VendorRow["kind"],
    default_payment_mode: v.default_payment_mode as VendorRow["default_payment_mode"],
    tracks_portal_balance: Boolean(v.tracks_portal_balance),
    portal_owner_vendor_id: v.portal_owner_vendor_id as string | null,
    portal_owner_name: (v.owner as { name: string } | null)?.name ?? null,
    opening_balance: Number(v.opening_balance ?? 0),
    opening_balance_date: v.opening_balance_date as string | null,
    is_active: Boolean(v.is_active),
    note: v.note as string | null,
    // Counted rather than listed: the table shows how many spellings resolve
    // here, which is the number worth seeing at a glance; the spellings
    // themselves belong on a detail screen that does not exist yet.
    alias_count: ((v.vendor_aliases as unknown[]) ?? []).length,
  }));

  return { rows, error: null };
}

/** The institutes actually used as a parent, for the filter. */
export function instituteOptions(rows: VendorRow[]): string[] {
  return [...new Set(rows.map((r) => r.institute).filter(Boolean) as string[])].sort();
}
