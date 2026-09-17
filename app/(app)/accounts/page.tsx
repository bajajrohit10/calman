import Link from "next/link";

import { Badge, ErrorNote, PageHeader, Select, CELL, TABLE_HEAD_ROW, cx } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { istToday } from "@/lib/format";
import { loadBatches } from "@/lib/accounts/sales";
import { loadVendorMonths } from "@/lib/accounts/statements";

export const metadata = { title: "Accounts · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
const money = (n: number | null) =>
  n === null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * §50G.3. The month at a glance.
 *
 * One row per vendor with something in it, ordered by what we owe, so closing
 * a month is a list to work down rather than a hunt through a vendor picker.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAccountsProfile();
  const sp = await searchParams;

  const batches = await loadBatches();
  const months = batches.map((b) => String(b.month).slice(0, 7));
  const month = one(sp.month) || months[0] || istToday().slice(0, 7);

  const { rows, error } = await loadVendorMonths(month);
  const totals = rows.reduce((a, r) => ({
    lines: a.lines + r.lines,
    remittance: a.remittance + r.remittance,
    paid: a.paid + r.paid,
    adjustments: a.adjustments + r.adjustments,
    diff: a.diff + r.diff,
  }), { lines: 0, remittance: 0, paid: 0, adjustments: 0, diff: 0 });

  const closed = rows.filter((r) => r.statement_status !== "draft").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Accounts"
        description="The month by vendor: what was sold, what we owe, what has gone out."
      />

      <form method="GET"
            className="flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">Month</span>
          <Select name="month" defaultValue={month} className="w-[140px]" data-testid="ov-month">
            {(months.length ? months : [month]).map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </label>
        <button type="submit" className="h-[30px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink">
          Apply
        </button>
        <span className="ml-auto text-[12px] text-ink-3" data-testid="ov-closed">
          {closed} of {rows.length} vendor{rows.length === 1 ? "" : "s"} closed
        </span>
        <Link href="/accounts/statements" className="text-[12.5px] text-ink-2 underline-offset-2 hover:underline">
          Statements
        </Link>
        <Link href="/accounts/reconcile" className="text-[12.5px] text-ink-2 underline-offset-2 hover:underline">
          Reconcile
        </Link>
        <Link href="/accounts/wallets" className="text-[12.5px] text-ink-2 underline-offset-2 hover:underline">
          Wallets
        </Link>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[1080px] text-left text-[12.5px]">
          <thead className={TABLE_HEAD_ROW}>
            <tr>
              <th className="px-2 py-[7px]">Vendor</th>
              <th className="px-2 py-[7px]">Kind</th>
              <th className="px-2 py-[7px] text-right">Lines</th>
              <th className="px-2 py-[7px] text-right">Remittance</th>
              <th className="px-2 py-[7px] text-right">Paid</th>
              <th className="px-2 py-[7px] text-right">Adjustments</th>
              <th className="px-2 py-[7px] text-right">Diff</th>
              <th className="px-2 py-[7px]">Statement</th>
              <th className="px-2 py-[7px] text-right">Wallet</th>
              <th className="px-2 py-[7px]">Go to</th>
            </tr>
          </thead>
          <tbody data-testid="ov-rows">
            {rows.map((r) => (
              <tr key={r.vendor_id} className="border-b border-line last:border-b-0">
                <td className={cx(CELL, "text-ink")}>{r.vendor_name}</td>
                <td className={cx(CELL, "text-ink-3")}>{r.kind}</td>
                <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>{r.lines}</td>
                <td className={cx(CELL, "text-right tabular-nums text-ink")}>{money(r.remittance)}</td>
                <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>{money(r.paid)}</td>
                <td className={cx(CELL, "text-right tabular-nums",
                  r.adjustments < 0 ? "text-danger" : "text-ink-3")}>
                  {r.adjustments ? money(r.adjustments) : "—"}
                </td>
                <td className={cx(CELL, "text-right tabular-nums",
                  r.diff > 1 ? "text-warn" : r.diff < -1 ? "text-danger" : "text-ink-3")}>
                  {money(r.diff)}
                </td>
                <td className={CELL}>
                  <Badge tone={r.statement_status === "paid" ? "accent"
                    : r.statement_status === "final" ? "info" : "neutral"}>
                    <span data-testid={`ov-status-${r.vendor_id}`}>
                      {r.statement_status}{r.version ? ` v${r.version}` : ""}
                    </span>
                  </Badge>
                </td>
                <td className={cx(CELL, "text-right tabular-nums",
                  (r.wallet_balance ?? 0) < 0 ? "text-danger" : "text-ink-2")}>
                  {r.wallet_balance === null ? "—" : money(r.wallet_balance)}
                </td>
                <td className={cx(CELL, "text-[11.5px]")}>
                  <Link href={`/accounts/statements?month=${month}&vendor=${r.vendor_id}`}
                        className="text-ink-2 underline-offset-2 hover:underline">Statement</Link>
                  {" · "}
                  <Link href={`/accounts/sales?vendor=${r.vendor_id}`}
                        className="text-ink-2 underline-offset-2 hover:underline">Lines</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-ink-3" data-testid="ov-empty">
                  Nothing in {month}.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="sticky bottom-0 border-t border-line bg-sunk">
            <tr data-testid="ov-footer">
              <td className={cx(CELL, "font-semibold text-ink")} colSpan={2}>
                <span data-testid="ov-vendor-count">{rows.length}</span> vendors
              </td>
              <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}>{totals.lines}</td>
              <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                  data-testid="ov-total-remittance">{money(Math.round(totals.remittance * 100) / 100)}</td>
              <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                  data-testid="ov-total-paid">{money(Math.round(totals.paid * 100) / 100)}</td>
              <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}>
                {money(Math.round(totals.adjustments * 100) / 100)}
              </td>
              <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                  data-testid="ov-total-diff">{money(Math.round(totals.diff * 100) / 100)}</td>
              <td className={CELL} colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
