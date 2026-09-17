import Link from "next/link";

import { Badge, ErrorNote, PageHeader, Select, CELL, TABLE_HEAD_ROW, cx } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { LEVELS, PRODUCT_TYPES } from "@/lib/accounts/rates";
import { LINE_STATUSES, RATE_SOURCES, SALES_TABS, type SalesTab } from "@/lib/accounts/sales-enums";
import { loadBatches, loadSalesLines, loadVendorChoices } from "@/lib/accounts/sales";
import { LineFix, Truncated } from "./line-actions";

export const metadata = { title: "Sales · Accounts · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

const money = (n: number | null) =>
  n === null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n === null ? "—" : `${Number(n).toFixed(2).replace(/\.00$/, "")}%`);

const SOURCE_TONE: Record<string, "accent" | "info" | "warn" | "neutral"> = {
  grid: "accent", combo: "info", state_rule: "info",
  line_override: "warn", none: "neutral",
};

/**
 * §50E.3. A month of sales, and what each line earns.
 *
 * The footer is the point of the filters: every number in it describes exactly
 * the rows on screen, so "what do we owe this vendor for August" is a filter
 * away rather than an export away.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireAccountsProfile();
  const sp = await searchParams;

  const batches = await loadBatches();
  const batchId = one(sp.batch) || batches[0]?.id || "";
  const batch = batches.find((b) => b.id === batchId) ?? batches[0] ?? null;

  const tab = (SALES_TABS.find((t) => t.id === one(sp.tab))?.id ?? "all") as SalesTab;

  const filters = {
    batchId,
    tab,
    vendor: one(sp.vendor),
    status: one(sp.status),
    rateSource: one(sp.source),
    level: one(sp.level),
    productType: one(sp.type),
    attention: one(sp.attention) === "1",
  };

  const { rows, error } = batch
    ? await loadSalesLines(filters)
    : { rows: [], error: null };
  // The tab counts describe the month, not the current filter — otherwise the
  // numbers on the tabs would move every time somebody narrowed the view.
  const { rows: monthRows } = batch
    ? await loadSalesLines({ batchId })
    : { rows: [] };
  const tabCount = (id: SalesTab) => {
    const mode = SALES_TABS.find((t) => t.id === id)?.mode ?? null;
    return mode ? monthRows.filter((r) => r.payment_mode === mode).length : monthRows.length;
  };
  const vendors = await loadVendorChoices();

  // One entry per vendor for the filter, from the names only.
  const vendorOptions = [...new Map(
    vendors.filter((v) => !v.label.includes("→")).map((v) => [v.id, v.label]),
  ).entries()].map(([id, label]) => ({ id, label }));

  const totalPrice = rows.reduce((a, r) => a + (r.teachers_price ?? 0), 0);
  const totalRemit = rows.reduce((a, r) => a + (r.calculated_remittance ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Sales"
        description="Every line of the month, what it was rated at, and what the teacher is owed."
      />

      {batch ? (
        <nav className="flex flex-wrap gap-1.5" data-testid="sales-tabs">
          {SALES_TABS.map((t) => {
            const p = new URLSearchParams();
            p.set("batch", batch.id);
            if (t.id !== "all") p.set("tab", t.id);
            for (const [k, v] of Object.entries({
              vendor: filters.vendor, status: filters.status, source: filters.rateSource,
              level: filters.level, type: filters.productType,
            })) if (v) p.set(k, v as string);
            if (filters.attention) p.set("attention", "1");
            return (
              <Link key={t.id} href={`/accounts/sales?${p}`}
                    data-testid={`sales-tab-${t.id}`}
                    aria-current={t.id === tab ? "page" : undefined}
                    className={cx("rounded-md px-2.5 py-1 text-[12.5px]",
                      t.id === tab ? "bg-accent text-accent-ink"
                                   : "border border-line-2 bg-surface text-ink-2 hover:bg-surface-2")}>
                {t.label}{" "}
                <span className="tabular-nums" data-testid={`sales-tab-count-${t.id}`}>
                  {tabCount(t.id)}
                </span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {!batch ? (
        <p className="rounded-lg border border-line bg-surface px-3 py-8 text-center text-[12.5px] text-ink-3"
           data-testid="no-batches">
          No sales imported yet. <Link href="/accounts/sales/import" className="underline">Import a month</Link>.
        </p>
      ) : (
        <>
          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <form method="GET"
                className="flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
            {/* Filtering keeps you in the tab you were reading. */}
            <input type="hidden" name="tab" value={tab} />
            <Field label="Month">
              <Select name="batch" defaultValue={batch.id} className="w-[150px]" data-testid="filter-batch">
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>{String(b.month).slice(0, 7)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Vendor">
              <Select name="vendor" defaultValue={filters.vendor} className="w-[190px]" data-testid="filter-vendor">
                <option value="">Any</option>
                {vendorOptions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select name="status" defaultValue={filters.status} className="w-[120px]" data-testid="filter-status">
                <option value="">Any</option>
                {LINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Rate source">
              <Select name="source" defaultValue={filters.rateSource} className="w-[140px]" data-testid="filter-source">
                <option value="">Any</option>
                {RATE_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Level">
              <Select name="level" defaultValue={filters.level} className="w-[140px]" data-testid="filter-level">
                <option value="">Any</option>
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Type">
              <Select name="type" defaultValue={filters.productType} className="w-[110px]" data-testid="filter-type">
                <option value="">Any</option>
                {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <input type="checkbox" name="attention" value="1"
                     defaultChecked={filters.attention} data-testid="filter-attention" />
              Needs attention
            </label>
            <button type="submit"
                    className="h-[30px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink">
              Apply
            </button>
            <Link href={`/accounts/sales?batch=${batch.id}${tab !== "all" ? `&tab=${tab}` : ""}`}
                  className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline">
              Clear
            </Link>
            <Link href="/accounts/sales/import"
                  className="ml-auto text-[12.5px] text-ink-2 underline-offset-2 hover:underline">
              Import a month
            </Link>
          </form>

          <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
            <table className="w-full min-w-[1400px] text-left text-[12.5px]">
              <thead className={TABLE_HEAD_ROW}>
                <tr>
                  <th className="px-2 py-[7px]">Order</th>
                  <th className="px-2 py-[7px]">Date</th>
                  <th className="px-2 py-[7px]">Student</th>
                  <th className="px-2 py-[7px]">Course</th>
                  <th className="px-2 py-[7px]">Vendor</th>
                  <th className="px-2 py-[7px]">Level</th>
                  <th className="px-2 py-[7px]">Type</th>
                  <th className="px-2 py-[7px]">Combo</th>
                  <th className="px-2 py-[7px] text-right">Teacher’s price</th>
                  <th className="px-2 py-[7px] text-right">Rate</th>
                  <th className="px-2 py-[7px]">Source</th>
                  <th className="px-2 py-[7px] text-right">Remittance</th>
                  <th className="px-2 py-[7px]">Status</th>
                  <th className="px-2 py-[7px]">Remarks</th>
                  <th className="px-2 py-[7px]">Fix</th>
                </tr>
              </thead>
              <tbody data-testid="sales-rows">
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                    <td className={cx(CELL, "text-ink")}>{r.order_id}</td>
                    <td className={cx(CELL, "text-ink-2")}>
                      {r.order_date ? r.order_date.slice(0, 10) : "—"}
                    </td>
                    <td className={cx(CELL, "text-ink-2")}>
                      <Truncated text={r.student_name} width="max-w-[130px]" />
                    </td>
                    <td className={cx(CELL, "text-ink-2")}>
                      <Truncated text={r.course_title} width="max-w-[260px]" />
                    </td>
                    <td className={cx(CELL, r.vendor_name ? "text-ink-2" : "text-danger")}
                        data-testid={r.vendor_name ? undefined : "vendor-missing"}>
                      {r.vendor_name ?? "unresolved"}
                    </td>
                    <td className={cx(CELL, "text-ink-2")}>{r.level ?? "—"}</td>
                    <td className={cx(CELL, "text-ink-2")}>{r.product_type ?? "—"}</td>
                    <td className={cx(CELL, "text-ink-3")}>{r.is_combo ? "combo" : "—"}</td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>
                      {money(r.teachers_price)}
                    </td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink")}>{pct(r.rate_pct)}</td>
                    <td className={CELL}>
                      <Badge tone={SOURCE_TONE[r.rate_source ?? "none"] ?? "neutral"}>
                        {r.rate_source ?? "none"}
                      </Badge>
                    </td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink")}
                        data-testid="remittance-cell">
                      {money(r.calculated_remittance)}
                    </td>
                    <td className={CELL}>
                      <Badge tone={r.status === "draft" ? "neutral" : r.status === "paid" ? "accent" : "warn"}>
                        {r.status}
                      </Badge>
                      {r.no_remittance_reason ? (
                        <span className="block text-[11px] text-warn">{r.no_remittance_reason}</span>
                      ) : null}
                    </td>
                    <td className={cx(CELL, "text-ink-3")}>
                      <Truncated text={r.remarks} width="max-w-[170px]" />
                      {r.conversion ? (
                        <span className="block text-[11px] text-info" data-testid="conversion-note">
                          conversion {money(r.conversion.difference_amount)}
                          {r.conversion.reason ? ` · ${r.conversion.reason}` : ""}
                        </span>
                      ) : null}
                      {r.override_note ? (
                        <span className="block text-[11px] text-ink-3">{r.override_note}</span>
                      ) : null}
                    </td>
                    <td className={CELL}>
                      <LineFix lineId={r.id} vendors={vendors}
                               hasOverride={r.override_pct !== null}
                               reason={r.no_remittance_reason} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="px-3 py-8 text-center text-ink-3" data-testid="sales-empty">
                      No lines match these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {/* Sticky so the totals stay with you through 1,500 rows. */}
              <tfoot className="sticky bottom-0 border-t border-line bg-sunk">
                <tr data-testid="sales-footer">
                  <td className={cx(CELL, "font-semibold text-ink")} colSpan={8}>
                    <span data-testid="footer-count">{rows.length}</span> line
                    {rows.length === 1 ? "" : "s"}
                  </td>
                  <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                      data-testid="footer-price">
                    {money(totalPrice)}
                  </td>
                  <td className={CELL} colSpan={2} />
                  <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                      data-testid="footer-remittance">
                    {money(totalRemit)}
                  </td>
                  <td className={CELL} colSpan={3} />
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
      <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
        {label}
      </span>
      {children}
    </label>
  );
}
