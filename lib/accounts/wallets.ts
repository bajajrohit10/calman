import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/paged";

/**
 * §50G.1(b). The portal wallets.
 *
 * A wallet belongs to whoever we top up — an institute, usually — and every
 * portal or centre sale spends from it. The balance is never stored: it is the
 * running sum of the ledger, so it cannot drift away from its entries.
 */

export type LedgerEntry = {
  id: string;
  entry_date: string;
  kind: string;
  amount: number;
  order_id: string | null;
  note: string | null;
  balance_after: number;
};

export type Wallet = {
  vendor_id: string;
  vendor_name: string;
  institute: string | null;
  balance: number;
  last_top_up: { date: string; amount: number } | null;
  deductions_this_month: number;
  /** Mean monthly spend over the last three months that had any. */
  average_monthly_deductions: number;
  low: boolean;
  entries: LedgerEntry[];
};

export async function loadWallets(month: string): Promise<{ wallets: Wallet[]; error: string | null }> {
  const supabase = await createClient();

  const { data: owners, error: vErr } = await supabase
    .schema("accounts").from("vendors")
    .select("id, name, institute")
    .eq("tracks_portal_balance", true)
    .is("portal_owner_vendor_id", null)
    .order("name");
  if (vErr) return { wallets: [], error: vErr.message };

  const { rows: ledger, error } = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase.schema("accounts").from("portal_balances")
      .select("vendor_id, id, entry_date, kind, amount, order_id, note, balance_after")
      .order("entry_date").range(from, to));
  if (error) return { wallets: [], error };

  const byVendor = new Map<string, LedgerEntry[]>();
  for (const e of ledger) {
    const k = e.vendor_id as string;
    if (!byVendor.has(k)) byVendor.set(k, []);
    byVendor.get(k)!.push({
      id: e.id as string,
      entry_date: e.entry_date as string,
      kind: e.kind as string,
      amount: Number(e.amount ?? 0),
      order_id: (e.order_id as string) ?? null,
      note: (e.note as string) ?? null,
      balance_after: Number(e.balance_after ?? 0),
    });
  }

  const monthStart = `${month}-01`;
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString().slice(0, 10);

  const wallets: Wallet[] = (owners ?? []).map((v) => {
    const entries = byVendor.get(v.id as string) ?? [];
    const balance = entries.length ? entries[entries.length - 1].balance_after : 0;

    const topUps = entries.filter((e) => e.kind === "top_up");
    const lastTopUp = topUps.length
      ? { date: topUps[topUps.length - 1].entry_date, amount: topUps[topUps.length - 1].amount }
      : null;

    const thisMonth = entries
      .filter((e) => e.kind === "deduction" && e.entry_date >= monthStart && e.entry_date <= monthEnd)
      .reduce((a, e) => a + Math.abs(e.amount), 0);

    // Average over the last three calendar months that actually had spend —
    // averaging over three months when a wallet only opened last week would
    // make every new wallet look healthy.
    const byMonth = new Map<string, number>();
    for (const e of entries) {
      if (e.kind !== "deduction") continue;
      const m = e.entry_date.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + Math.abs(e.amount));
    }
    const recent = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3);
    const average = recent.length
      ? recent.reduce((a, [, n]) => a + n, 0) / recent.length
      : 0;

    // With fewer than three months of history there is no meaningful average,
    // so the only honest warning is an overdrawn wallet.
    const low = recent.length >= 3 ? balance < average : balance < 0;

    return {
      vendor_id: v.id as string,
      vendor_name: v.name as string,
      institute: (v.institute as string) ?? null,
      balance: Math.round(balance * 100) / 100,
      last_top_up: lastTopUp,
      deductions_this_month: Math.round(thisMonth * 100) / 100,
      average_monthly_deductions: Math.round(average * 100) / 100,
      low,
      entries: entries.slice(-40).reverse(),
    };
  });

  return { wallets, error: null };
}
