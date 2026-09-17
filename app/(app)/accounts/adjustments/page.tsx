import Link from "next/link";

import { ErrorNote, PageHeader, Select, CELL, TABLE_HEAD_ROW, cx } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadBatches, loadVendorChoices } from "@/lib/accounts/sales";
import { ADJUSTMENT_REASON_LABELS } from "@/lib/accounts/adjustment-enums";
import { AddAdjustment, DeleteAdjustment } from "./adjustment-form";

export const metadata = { title: "Adjustments · Accounts · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * §50G.1(a). Manual lines on a vendor's month.
 *
 * Everything the automatic pipeline cannot know: a refund we absorbed, a
 * cancellation charge, a correction to a month already closed. They land on
 * the statement as their own rows rather than being folded into a line,
 * because a vendor reading it should see what changed and why.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAccountsProfile();
  const sp = await searchParams;
  const supabase = await createClient();

  const batches = await loadBatches();
  const months = batches.map((b) => String(b.month).slice(0, 7));
  const month = one(sp.month) || months[0] || new Date().toISOString().slice(0, 7);
  const vendorFilter = one(sp.vendor);

  const vendorChoices = (await loadVendorChoices()).filter((v) => !v.label.includes("→"));

  let q = supabase
    .schema("accounts").from("adjustments")
    .select("id, amount, reason, linked_order_id, note, created_at, vendor_id, vendors ( name )")
    .eq("month", `${month}-01`)
    .order("created_at", { ascending: false });
  if (vendorFilter) q = q.eq("vendor_id", vendorFilter);
  const { data, error } = await q;

  const rows = (data ?? []).map((a) => ({
    id: a.id as string,
    amount: Number(a.amount ?? 0),
    reason: (a.reason as string) ?? null,
    linked: (a.linked_order_id as string) ?? null,
    note: (a.note as string) ?? null,
    vendor: ((a.vendors as { name: string } | null) ?? null)?.name ?? "—",
  }));
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Adjustments"
        description="Manual credits and deductions on a vendor's month. They appear on the statement as their own lines."
      />

      <AddAdjustment vendors={vendorChoices} month={month} />

      <form method="GET"
            className="flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
        <label className="flex flex-col gap-1">
          <span className={FIELD}>Month</span>
          <Select name="month" defaultValue={month} className="w-[140px]" data-testid="adj-month">
            {(months.length ? months : [month]).map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD}>Vendor</span>
          <Select name="vendor" defaultValue={vendorFilter} className="w-[220px]"
                  data-testid="adj-filter-vendor">
            <option value="">Any</option>
            {vendorChoices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </label>
        <button type="submit"
                className="h-[30px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink">
          Apply
        </button>
        <Link href="/accounts/adjustments" className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline">
          Clear
        </Link>
      </form>

      {error ? <ErrorNote>{error.message}</ErrorNote> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[900px] text-left text-[12.5px]">
          <thead className={TABLE_HEAD_ROW}>
            <tr>
              <th className="px-2 py-[7px]">Vendor</th>
              <th className="px-2 py-[7px] text-right">Amount</th>
              <th className="px-2 py-[7px]">Reason</th>
              <th className="px-2 py-[7px]">Order</th>
              <th className="px-2 py-[7px]">Note</th>
              <th className="px-2 py-[7px]" />
            </tr>
          </thead>
          <tbody data-testid="adj-rows">
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <td className={cx(CELL, "text-ink")}>{r.vendor}</td>
                <td className={cx(CELL, "text-right tabular-nums",
                  r.amount < 0 ? "text-danger" : "text-ink")}>{money(r.amount)}</td>
                <td className={cx(CELL, "text-ink-2")}>
                  {r.reason ? ADJUSTMENT_REASON_LABELS[r.reason] ?? r.reason : "—"}
                </td>
                <td className={cx(CELL, "text-ink-3")}>{r.linked ?? "—"}</td>
                <td className={cx(CELL, "text-ink-3")}>{r.note ?? "—"}</td>
                <td className={CELL}><DeleteAdjustment id={r.id} /></td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-3" data-testid="adj-empty">
                  No adjustments for {month}.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="border-t border-line bg-sunk">
            <tr>
              <td className={cx(CELL, "font-semibold text-ink")}>
                <span data-testid="adj-count">{rows.length}</span> adjustment{rows.length === 1 ? "" : "s"}
              </td>
              <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                  data-testid="adj-total">{money(total)}</td>
              <td className={CELL} colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

const FIELD = "text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";
