import Link from "next/link";

import { Badge, ErrorNote, PageHeader, Select, Input, CELL, TABLE_HEAD_ROW, cx } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { istToday } from "@/lib/format";
import { loadBatches, loadVendorChoices } from "@/lib/accounts/sales";
import { ADJUSTMENT_REASON_LABELS } from "@/lib/accounts/adjustment-enums";
import { loadStatement } from "@/lib/accounts/statements";
import { MarkReady, MarkPaid } from "./close-forms";

export const metadata = { title: "Statements · Accounts · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
const money = (n: number | null) =>
  n === null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const FIELD = "text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";

const KINDS = [
  { id: "teacher", label: "Teacher" },
  { id: "institute", label: "Institute" },
  { id: "books", label: "Books" },
];

/**
 * §50G.2. One vendor's month, as they will see it.
 *
 * The same numbers the reconcile screen works from, arranged for somebody who
 * did not do the reconciling: what was sold, what we owe on it, what has been
 * paid, and what is left.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAccountsProfile();
  const sp = await searchParams;

  const batches = await loadBatches();
  const months = batches.map((b) => String(b.month).slice(0, 7));
  const month = one(sp.month) || months[0] || istToday().slice(0, 7);
  const search = one(sp.q);
  const kind = one(sp.kind);
  const vendorId = one(sp.vendor);

  const all = (await loadVendorChoices()).filter((v) => !v.label.includes("→"));
  const options = all.filter((v) =>
    !search || v.label.toLowerCase().includes(search.toLowerCase()));

  const { statement, error } = vendorId
    ? await loadStatement(vendorId, month)
    : { statement: null, error: null };

  const qs = new URLSearchParams({ month });
  if (vendorId) qs.set("vendor", vendorId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Statements"
        description="What each vendor is owed for the month, and what has been settled."
      />

      <form method="GET"
            className="flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
        <label className="flex flex-col gap-1">
          <span className={FIELD}>Month</span>
          <Select name="month" defaultValue={month} className="w-[130px]" data-testid="stmt-month">
            {(months.length ? months : [month]).map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD}>Search</span>
          <Input name="q" defaultValue={search} placeholder="Vendor name…" className="w-[180px]"
                 data-testid="stmt-search" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD}>Kind</span>
          <Select name="kind" defaultValue={kind} className="w-[140px]" data-testid="stmt-kind">
            <option value="">Any</option>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD}>Vendor</span>
          <Select name="vendor" defaultValue={vendorId} className="w-[240px]" data-testid="stmt-vendor">
            <option value="">— choose —</option>
            {options.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </label>
        <button type="submit" className="h-[30px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink">
          Show
        </button>
        <a href={`/accounts/statements/export?${qs}`}
           className="ml-auto rounded-md border border-line-2 px-2.5 py-[5px] text-[12.5px] text-ink-2 hover:bg-surface-2"
           data-testid="stmt-download">
          Download xlsx
        </a>
        <a href={`/accounts/statements/export?month=${month}&all=1`}
           className="rounded-md border border-line-2 px-2.5 py-[5px] text-[12.5px] text-ink-2 hover:bg-surface-2"
           data-testid="stmt-download-all">
          Download all
        </a>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {!statement ? (
        <p className="rounded-lg border border-line bg-surface px-3 py-8 text-center text-[12.5px] text-ink-3"
           data-testid="stmt-none">
          Choose a vendor to see its statement.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface p-3 shadow-card"
               data-testid="stmt-header">
            <div className="min-w-[220px]">
              <h2 className="text-[15px] font-semibold text-ink" data-testid="stmt-vendor-name">
                {statement.vendor_name}
              </h2>
              <div className="text-[12px] text-ink-3">{statement.institute ?? "—"}</div>
            </div>
            <Meta label="Month" value={statement.month} />
            <Meta label="Payment mode" value={statement.payment_mode} />
            <Meta label="Generated" value={istToday()} />
            <div className="flex flex-col gap-0.5">
              <span className={FIELD}>Status</span>
              <Badge tone={statement.status === "paid" ? "accent" : statement.status === "final" ? "info" : "neutral"}>
                <span data-testid="stmt-status">
                  {statement.status}{statement.version ? ` v${statement.version}` : ""}
                </span>
              </Badge>
            </div>
            {statement.paid_on ? (
              <Meta label="Paid on" value={`${statement.paid_on} · ${statement.payment_reference ?? ""}`} />
            ) : null}
            <div className="ml-auto flex flex-col items-end gap-1.5">
              <MarkReady vendorId={statement.vendor_id} month={month}
                         isFinal={statement.status !== "draft"} />
              <MarkPaid vendorId={statement.vendor_id} month={month} today={istToday()}
                        disabled={statement.status === "draft"} />
            </div>
          </div>

          {statement.wallet ? (
            <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-3 shadow-card"
                 data-testid="stmt-wallet">
              <h3 className="w-full text-[12.5px] font-semibold text-ink">Wallet</h3>
              <Meta label="Opening" value={money(statement.wallet.opening)} />
              <Meta label="Top-ups" value={money(statement.wallet.top_ups)} />
              <Meta label="Deductions" value={money(statement.wallet.deductions)} />
              <Meta label="Closing" value={money(statement.wallet.closing)} />
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
            <table className="w-full min-w-[1500px] text-left text-[12.5px]">
              <thead className={TABLE_HEAD_ROW}>
                <tr>
                  <th className="px-2 py-[7px]">Order</th>
                  <th className="px-2 py-[7px]">Date</th>
                  <th className="px-2 py-[7px]">Student</th>
                  <th className="px-2 py-[7px]">Course</th>
                  <th className="px-2 py-[7px]">Medium</th>
                  <th className="px-2 py-[7px] text-right">List</th>
                  <th className="px-2 py-[7px] text-right">Teacher’s</th>
                  <th className="px-2 py-[7px] text-right">Base</th>
                  <th className="px-2 py-[7px] text-right">%</th>
                  <th className="px-2 py-[7px] text-right">Remittance</th>
                  <th className="px-2 py-[7px]">Mode</th>
                  <th className="px-2 py-[7px] text-right">Paid</th>
                  <th className="px-2 py-[7px] text-right">Balance</th>
                  <th className="px-2 py-[7px]">Remarks</th>
                </tr>
              </thead>
              <tbody data-testid="stmt-rows">
                {statement.lines.map((l) => (
                  <tr key={l.order_id}
                      className={cx("border-b border-line last:border-b-0",
                        l.no_remittance_reason ? "text-ink-3 opacity-60" : "")}>
                    <td className={cx(CELL, l.no_remittance_reason ? "" : "text-ink")}>{l.order_id}</td>
                    <td className={cx(CELL, "text-ink-2")}>{l.order_date?.slice(0, 10) ?? "—"}</td>
                    <td className={cx(CELL, "text-ink-2")}>
                      <span className="block max-w-[130px] truncate" title={l.student_name ?? ""}>
                        {l.student_name ?? "—"}
                      </span>
                    </td>
                    <td className={cx(CELL, "text-ink-2")}>
                      <span className="block max-w-[240px] truncate" title={l.course_title ?? ""}>
                        {l.course_title ?? "—"}
                      </span>
                    </td>
                    <td className={cx(CELL, "text-ink-3")}>
                      <span className="block max-w-[130px] truncate" title={l.course_medium ?? ""}>
                        {l.course_medium ?? "—"}
                      </span>
                    </td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink-3")}>{money(l.list_price)}</td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>{money(l.teachers_price)}</td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>
                      {money(l.base_amount)}
                      {/* §50G.2. Marked when the base is not the teacher's
                          price, because that is the line a vendor queries. */}
                      {l.base_amount !== null && l.teachers_price !== null
                       && l.base_amount !== l.teachers_price ? (
                        <span className="block text-[10.5px] text-info" data-testid="stmt-base-marked">
                          {l.base_source}
                        </span>
                      ) : null}
                    </td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>
                      {l.rate_pct === null ? "—" : `${l.rate_pct}%`}
                    </td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink")}>
                      {money(l.calculated_remittance)}
                      {l.no_remittance_reason ? (
                        <span className="block text-[10.5px] text-warn">{l.no_remittance_reason}</span>
                      ) : null}
                    </td>
                    <td className={cx(CELL, "text-ink-3")}>{l.payment_mode ?? "—"}</td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>{money(l.paid)}</td>
                    <td className={cx(CELL, "text-right tabular-nums",
                      l.balance_due > 1 ? "text-warn" : "text-ink-3")}>{money(l.balance_due)}</td>
                    <td className={cx(CELL, "text-ink-3")}>
                      <span className="block max-w-[150px] truncate" title={l.remarks ?? ""}>
                        {l.remarks ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}

                {statement.adjustments.map((a) => (
                  <tr key={a.id} className="border-b border-line bg-sunk last:border-b-0"
                      data-testid="stmt-adjustment">
                    <td className={cx(CELL, "text-ink")} colSpan={4}>
                      Adjustment — {a.reason ? ADJUSTMENT_REASON_LABELS[a.reason] ?? a.reason : "—"}
                      {a.linked_order_id ? ` (${a.linked_order_id})` : ""}
                    </td>
                    <td className={CELL} colSpan={5} />
                    <td className={cx(CELL, "text-right tabular-nums",
                      a.amount < 0 ? "text-danger" : "text-ink")}>{money(a.amount)}</td>
                    <td className={CELL} colSpan={3} />
                    <td className={cx(CELL, "text-ink-3")}>{a.note ?? "—"}</td>
                  </tr>
                ))}

                {statement.lines.length === 0 && statement.adjustments.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-3 py-8 text-center text-ink-3" data-testid="stmt-empty">
                      Nothing for this vendor in {month}.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot className="sticky bottom-0 border-t border-line bg-sunk">
                <tr data-testid="stmt-footer">
                  <td className={cx(CELL, "font-semibold text-ink")} colSpan={9}>
                    <span data-testid="stmt-line-count">{statement.lines.length}</span> line
                    {statement.lines.length === 1 ? "" : "s"}
                    {statement.adjustments.length
                      ? ` · ${statement.adjustments.length} adjustment${statement.adjustments.length === 1 ? "" : "s"}`
                      : ""}
                  </td>
                  <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                      data-testid="stmt-total-remittance">{money(statement.total_remittance)}</td>
                  <td className={CELL} />
                  <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                      data-testid="stmt-total-paid">{money(statement.total_paid)}</td>
                  <td className={cx(CELL, "text-right tabular-nums font-semibold text-ink")}
                      data-testid="stmt-net">{money(statement.net_payable)}</td>
                  <td className={cx(CELL, "text-[11px] text-ink-3")}>
                    adj {money(statement.total_adjustments)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-[11.5px] text-ink-3">
            Net payable = remittance {money(statement.total_remittance)} + adjustments{" "}
            {money(statement.total_adjustments)} − paid {money(statement.total_paid)}.{" "}
            <Link href={`/accounts/reconcile?batch=`} className="underline">Reconcile</Link> shows the same
            month line by line against what arrived.
          </p>
        </>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={FIELD}>{label}</span>
      <span className="text-[12.5px] text-ink">{value}</span>
    </div>
  );
}
