import Link from "next/link";

import { Badge, ErrorNote, PageHeader, Select, CELL, TABLE_HEAD_ROW, cx } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { loadBatches, loadVendorChoices } from "@/lib/accounts/sales";
import {
  RESULTS, RESULT_LABELS, loadPaymentBatches, loadReconciliation,
  type ReconResult,
} from "@/lib/accounts/reconcile";
import { RowFix, SavePortalPrice } from "./row-actions";

export const metadata = { title: "Reconcile · Accounts · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
const money = (n: number | null) =>
  n === null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const TONE: Record<ReconResult, "accent" | "warn" | "danger" | "info" | "neutral"> = {
  matched: "accent", underpaid: "danger", overpaid: "warn",
  unpaid: "danger", no_sale: "info", no_rate: "neutral", zero: "neutral",
};

/**
 * §50F.3. What we owe against what was paid.
 *
 * A row per sales line, plus a row per payment with no sale. The second kind
 * is the one worth looking at first: it is either an order that never
 * imported or money we were not owed.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireAccountsProfile();
  const sp = await searchParams;

  const [salesBatches, payBatches] = await Promise.all([loadBatches(), loadPaymentBatches()]);
  const batchId = one(sp.batch) || salesBatches[0]?.id || "";
  const batch = salesBatches.find((b) => b.id === batchId) ?? salesBatches[0] ?? null;
  const month = batch ? String(batch.month).slice(0, 7) : null;
  const payBatch = payBatches.find((p) => String(p.month).slice(0, 7) === month) ?? null;

  const vendorFilter = one(sp.vendor);
  const resultFilter = one(sp.result);

  const { rows: all, error } = batch
    ? await loadReconciliation(batch.id, payBatch?.id ?? null)
    : { rows: [], error: null };

  const rows = all.filter((r) =>
    (!vendorFilter || r.vendor_name === vendorFilter) &&
    (!resultFilter || r.result === resultFilter));

  const vendors = await loadVendorChoices();
  const vendorNames = [...new Set(all.map((r) => r.vendor_name).filter(Boolean))].sort() as string[];
  void vendors;

  const byResult = new Map<ReconResult, { n: number; calc: number; paid: number }>();
  for (const r of rows) {
    const cur = byResult.get(r.result) ?? { n: 0, calc: 0, paid: 0 };
    cur.n += 1; cur.calc += r.calculated; cur.paid += r.paid;
    byResult.set(r.result, cur);
  }
  const totalCalc = rows.reduce((a, r) => a + r.calculated, 0);
  const totalPaid = rows.reduce((a, r) => a + r.paid, 0);

  const qs = new URLSearchParams();
  if (batch) qs.set("batch", batch.id);
  if (vendorFilter) qs.set("vendor", vendorFilter);
  if (resultFilter) qs.set("result", resultFilter);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reconcile"
        description="Every line of the month against what the vendor actually paid."
      />

      {!batch ? (
        <p className="rounded-lg border border-line bg-surface px-3 py-8 text-center text-[12.5px] text-ink-3"
           data-testid="recon-no-batch">
          No sales imported yet.
        </p>
      ) : (
        <>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          {!payBatch ? (
            <p className="rounded-md border border-warn bg-warn-soft px-2.5 py-2 text-[12.5px] text-ink"
               data-testid="recon-no-payments">
              No payments imported for {month}. Every line will read as unpaid.{" "}
              <Link href="/accounts/payments/import" className="underline">Import payments</Link>.
            </p>
          ) : null}

          <form method="GET"
                className="flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
            <Field label="Month">
              <Select name="batch" defaultValue={batch.id} className="w-[140px]" data-testid="recon-batch">
                {salesBatches.map((b) => (
                  <option key={b.id} value={b.id}>{String(b.month).slice(0, 7)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Vendor">
              <Select name="vendor" defaultValue={vendorFilter} className="w-[200px]" data-testid="recon-vendor">
                <option value="">Any</option>
                {vendorNames.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Result">
              <Select name="result" defaultValue={resultFilter} className="w-[160px]" data-testid="recon-result">
                <option value="">Any</option>
                {RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABELS[r]}</option>)}
              </Select>
            </Field>
            <button type="submit"
                    className="h-[30px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink">
              Apply
            </button>
            <Link href={`/accounts/reconcile?batch=${batch.id}`}
                  className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline">Clear</Link>
            <a href={`/accounts/reconcile/export?${qs}`}
               className="ml-auto rounded-md border border-line-2 px-2.5 py-[5px] text-[12.5px] text-ink-2 hover:bg-surface-2"
               data-testid="recon-export">
              Export this view
            </a>
          </form>

          <div className="flex flex-wrap gap-2" data-testid="recon-summary">
            {RESULTS.map((r) => {
              const s = byResult.get(r);
              if (!s) return null;
              return (
                <div key={r} className="rounded-md border border-line bg-surface px-2.5 py-1.5"
                     data-testid={`recon-count-${r}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                    {RESULT_LABELS[r]}
                  </div>
                  <div className="text-[15px] tabular-nums text-ink">{s.n}</div>
                  <div className="text-[11px] text-ink-3">{money(s.paid)} paid</div>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
            <table className="w-full min-w-[1500px] text-left text-[12.5px]">
              <thead className={TABLE_HEAD_ROW}>
                <tr>
                  <th className="px-2 py-[7px]">Order</th>
                  <th className="px-2 py-[7px]">Vendor</th>
                  <th className="px-2 py-[7px]">Course</th>
                  <th className="px-2 py-[7px]">Status</th>
                  <th className="px-2 py-[7px] text-right">Base</th>
                  <th className="px-2 py-[7px] text-right">%</th>
                  <th className="px-2 py-[7px] text-right">Calculated</th>
                  <th className="px-2 py-[7px] text-right">Paid</th>
                  <th className="px-2 py-[7px] text-right">Diff</th>
                  <th className="px-2 py-[7px]">Method</th>
                  <th className="px-2 py-[7px]">Paid on</th>
                  <th className="px-2 py-[7px]">Result</th>
                  <th className="px-2 py-[7px]">Implied price</th>
                  <th className="px-2 py-[7px]">Fix</th>
                </tr>
              </thead>
              <tbody data-testid="recon-rows">
                {rows.slice(0, 600).map((r) => (
                  <tr key={r.key}
                      className={cx("border-b border-line align-top last:border-b-0",
                        r.result === "underpaid" ? "bg-danger-soft"
                        : r.result === "overpaid" ? "bg-warn-soft" : "")}>
                    <td className={cx(CELL, "text-ink")}>{r.order_id}</td>
                    <td className={cx(CELL, "text-ink-2")}>{r.vendor_name ?? "—"}</td>
                    <td className={cx(CELL, "text-ink-2")}>
                      <span className="block max-w-[230px] truncate" title={r.course_head ?? ""}>
                        {r.course_head ?? "—"}
                      </span>
                    </td>
                    <td className={cx(CELL, "text-ink-3")}>{r.status ?? "—"}</td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>
                      {money(r.base_amount)}
                      {r.base_source && r.base_source !== "teachers_price" ? (
                        <span className="block text-[10.5px] text-info">{r.base_source}</span>
                      ) : null}
                    </td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>
                      {r.rate_pct === null ? "—" : `${r.rate_pct}%`}
                    </td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink")}>{money(r.calculated)}</td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink")}>{money(r.paid)}</td>
                    <td className={cx(CELL, "text-right tabular-nums",
                      r.diff < -1 ? "text-danger" : r.diff > 1 ? "text-warn" : "text-ink-3")}>
                      {money(r.diff)}
                    </td>
                    <td className={cx(CELL, "text-ink-2")}>{r.methods.join(", ") || "—"}</td>
                    <td className={cx(CELL, "text-ink-3")}>{r.paid_on ?? "—"}</td>
                    <td className={CELL}>
                      <Badge tone={TONE[r.result]}>{RESULT_LABELS[r.result]}</Badge>
                      {r.reviewed ? (
                        <span className="block text-[10.5px] text-ink-3">reviewed</span>
                      ) : null}
                    </td>
                    <td className={CELL}>
                      {r.implied_price !== null && r.line_id ? (
                        <div className="flex flex-col gap-0.5" data-testid="implied-price">
                          <span className="tabular-nums text-ink">{money(r.implied_price)}</span>
                          <SavePortalPrice lineId={r.line_id} price={r.implied_price} />
                        </div>
                      ) : <span className="text-ink-3">—</span>}
                    </td>
                    <td className={CELL}>
                      <RowFix lineId={r.line_id} paymentIds={r.payment_ids}
                              reviewed={r.reviewed} reviewNote={r.review_note}
                              hasOverride={r.override_pct !== null} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-3 py-8 text-center text-ink-3" data-testid="recon-empty">
                      Nothing matches these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot className="sticky bottom-0 border-t border-line bg-sunk">
                <tr data-testid="recon-footer">
                  <td className={cx(CELL, "font-semibold text-ink")} colSpan={6}>
                    <span data-testid="recon-total-count">{rows.length}</span> row
                    {rows.length === 1 ? "" : "s"}
                    {rows.length > 600 ? " (first 600 shown; export for all)" : ""}
                  </td>
                  <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                      data-testid="recon-total-calc">{money(totalCalc)}</td>
                  <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                      data-testid="recon-total-paid">{money(totalPaid)}</td>
                  <td className={cx(CELL, "text-right tabular-nums font-semibold",
                    totalPaid - totalCalc < -1 ? "text-danger" : "text-ink")}
                      data-testid="recon-total-diff">{money(Math.round((totalPaid - totalCalc) * 100) / 100)}</td>
                  <td className={CELL} colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">{label}</span>
      {children}
    </label>
  );
}
