"use client";

import Link from "next/link";

import { ExportButton } from "@/components/export-button";
import { Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import { formatDate } from "@/lib/format";
import {
  ALL_STAGE_METRICS,
  REPORT_COLUMNS,
  STAGE_COLUMNS,
  STAGE_MEMO_COLUMNS,
  type Grain,
  type ReportMetric,
  type ReportRow,
  type StageMetric,
  type StageRow,
} from "@/lib/report-shape";

/**
 * §5.8. The daily table and the team summary are the same numbers: the
 * summary is the daily rows totalled by day, week or month, which is why
 * there is only one query behind both.
 */
export function ReportsView({
  rows,
  error,
  summary,
  stageRows,
  stageSummary,
  from,
  to,
  grain,
  isAdmin,
  counsellorId,
  roster,
}: {
  rows: ReportRow[];
  error: string | null;
  summary: { bucket: string; totals: Record<ReportMetric, number> }[];
  stageRows: StageRow[];
  stageSummary: { bucket: string; totals: Record<StageMetric, number> }[];
  from: string;
  to: string;
  grain: Grain;
  isAdmin: boolean;
  counsellorId: string | null;
  roster: { id: string; name: string }[];
}) {
  // Rows with nothing on them are noise: a counsellor's day off should not
  // print ten zeroes.
  const active = rows.filter((r) =>
    REPORT_COLUMNS.some((c) => Number(r[c.key] ?? 0) !== 0),
  );

  const activeStage = stageRows.filter((r) => Number(r.total_calls ?? 0) !== 0);

  // The footer totals the whole range, memo columns included — they are shown
  // in the same row but stay visually separated, because adding them to the
  // stage columns would double-count.
  const stageTotals = Object.fromEntries(
    ALL_STAGE_METRICS.map((k) => [
      k,
      stageRows.reduce((sum, r) => sum + Number(r[k] ?? 0), 0),
    ]),
  ) as Record<StageMetric, number>;

  const fmt = (key: ReportMetric, value: number) =>
    key === "purchased_amount"
      ? value
        ? `₹${Number(value).toLocaleString("en-IN")}`
        : "—"
      : value || "—";

  return (
    <div className="flex flex-col gap-4">
      <form method="GET" className="rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
              From
            </span>
            <Input type="date" name="from" defaultValue={from} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
              To
            </span>
            <Input type="date" name="to" defaultValue={to} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
              Summary by
            </span>
            <Select name="grain" defaultValue={grain} className="w-[120px]">
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </Select>
          </label>
          {isAdmin ? (
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
                Counsellor
              </span>
              <Select name="counsellor" defaultValue={counsellorId ?? ""} className="w-[190px]">
                <option value="">Everyone</option>
                {roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <Button type="submit" variant="primary" size="sm">
            Show
          </Button>
          <Link
            href="/reports"
            className="pb-1.5 text-[12.5px] text-ink-3 underline-offset-2 hover:underline"
          >
            Reset
          </Link>
          <div className="ml-auto">
            <ExportButton
              source="report"
              from={from}
              to={to}
              counsellorId={counsellorId}
            />
          </div>
        </div>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <section>
        <h2 className="mb-1.5 text-[13px] font-semibold text-ink">
          Team summary — by {grain}
        </h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-sunk/40 text-left text-[11px] uppercase tracking-wider text-ink-3">
                <th className="px-2 py-2">{grain === "day" ? "Day" : grain}</th>
                {REPORT_COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.bucket} className="border-b border-line last:border-b-0">
                  <td className="px-2 py-1.5 whitespace-nowrap text-ink">
                    {grain === "day" ? formatDate(s.bucket) : s.bucket}
                  </td>
                  {REPORT_COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className="px-2 py-1.5 text-right tabular-nums text-ink-2"
                    >
                      {fmt(c.key, s.totals[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {summary.length === 0 ? (
                <tr>
                  <td
                    colSpan={REPORT_COLUMNS.length + 1}
                    className="px-3 py-8 text-center text-ink-3"
                  >
                    No activity in this range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[13px] font-semibold text-ink">
          Daily, by counsellor
        </h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-sunk/40 text-left text-[11px] uppercase tracking-wider text-ink-3">
                <th className="px-2 py-2">Day</th>
                <th className="px-2 py-2">Counsellor</th>
                {REPORT_COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((r) => (
                <tr
                  key={`${r.day}-${r.counsellor_id}`}
                  className={cx("border-b border-line last:border-b-0")}
                >
                  <td className="px-2 py-1.5 whitespace-nowrap text-ink-3">
                    {formatDate(r.day)}
                  </td>
                  <td className="px-2 py-1.5 text-ink">{r.counsellor_name}</td>
                  {REPORT_COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className="px-2 py-1.5 text-right tabular-nums text-ink-2"
                    >
                      {fmt(c.key, Number(r[c.key] ?? 0))}
                    </td>
                  ))}
                </tr>
              ))}
              {active.length === 0 ? (
                <tr>
                  <td
                    colSpan={REPORT_COLUMNS.length + 2}
                    className="px-3 py-8 text-center text-ink-3"
                  >
                    Nothing was logged in this range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-3">
          Fresh handled counts every first-ever call whatever its outcome; follow-ups
          and call backs both exclude it, so the three never double-count a call. PLI
          issued excludes bulk imports. Overdue carried forward is what was on the
          list that day and never called.
        </p>
      </section>

      {/* -------------------------- stage-wise -------------------------- */}
      <section>
        <div className="mb-1.5 flex flex-wrap items-center gap-3">
          <h2 className="text-[13px] font-semibold text-ink">Stage-wise, by counsellor</h2>
          <div className="ml-auto">
            <ExportButton
              source="stage"
              from={from}
              to={to}
              counsellorId={counsellorId}
            />
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[1040px] border-collapse text-[12.5px]">
            <thead>
              {/* Two header rows so the memo columns can never be read as part
                  of the total. The stage columns are a partition; the memos cut
                  the same calls a second way. */}
              <tr className="border-b border-line bg-sunk/40 text-left text-[11px] uppercase tracking-wider text-ink-3">
                <th className="px-2 py-1.5" colSpan={2} />
                <th
                  className="border-l border-line px-2 py-1.5 text-center"
                  colSpan={STAGE_COLUMNS.length}
                >
                  By stage — these add up to Total calls
                </th>
                <th
                  className="border-l border-line px-2 py-1.5 text-center"
                  colSpan={STAGE_MEMO_COLUMNS.length}
                >
                  Of which — do not add these in
                </th>
              </tr>
              <tr className="border-b border-line bg-sunk/40 text-left text-[11px] uppercase tracking-wider text-ink-3">
                <th className="px-2 py-2">Day</th>
                <th className="px-2 py-2">Counsellor</th>
                {STAGE_COLUMNS.map((c, i) => (
                  <th
                    key={c.key}
                    className={cx(
                      "px-2 py-2 text-right",
                      i === 0 && "border-l border-line",
                      c.key === "total_calls" && "text-ink-2",
                    )}
                  >
                    {c.label}
                  </th>
                ))}
                {STAGE_MEMO_COLUMNS.map((c, i) => (
                  <th
                    key={c.key}
                    className={cx("px-2 py-2 text-right", i === 0 && "border-l border-line")}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeStage.map((r) => (
                <tr
                  key={`${r.day}-${r.counsellor_id}`}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-2 py-1.5 whitespace-nowrap text-ink-3">
                    {formatDate(r.day)}
                  </td>
                  <td className="px-2 py-1.5 text-ink">{r.counsellor_name}</td>
                  {STAGE_COLUMNS.map((c, i) => (
                    <td
                      key={c.key}
                      className={cx(
                        "px-2 py-1.5 text-right tabular-nums",
                        i === 0 && "border-l border-line",
                        c.key === "total_calls" ? "font-medium text-ink" : "text-ink-2",
                      )}
                    >
                      {Number(r[c.key] ?? 0) || "—"}
                    </td>
                  ))}
                  {STAGE_MEMO_COLUMNS.map((c, i) => (
                    <td
                      key={c.key}
                      className={cx(
                        "px-2 py-1.5 text-right tabular-nums text-ink-3",
                        i === 0 && "border-l border-line",
                      )}
                    >
                      {Number(r[c.key] ?? 0) || "—"}
                    </td>
                  ))}
                </tr>
              ))}
              {activeStage.length === 0 ? (
                <tr>
                  <td
                    colSpan={STAGE_COLUMNS.length + STAGE_MEMO_COLUMNS.length + 2}
                    className="px-3 py-8 text-center text-ink-3"
                  >
                    No calls in this range.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {stageSummary.length ? (
              <tfoot>
                <tr className="border-t-2 border-line bg-sunk/30 text-[12px]">
                  <td className="px-2 py-1.5 font-medium text-ink" colSpan={2}>
                    Total
                  </td>
                  {STAGE_COLUMNS.map((c, i) => (
                    <td
                      key={c.key}
                      className={cx(
                        "px-2 py-1.5 text-right font-medium tabular-nums text-ink",
                        i === 0 && "border-l border-line",
                      )}
                    >
                      {stageTotals[c.key] || "—"}
                    </td>
                  ))}
                  {STAGE_MEMO_COLUMNS.map((c, i) => (
                    <td
                      key={c.key}
                      className={cx(
                        "px-2 py-1.5 text-right tabular-nums text-ink-3",
                        i === 0 && "border-l border-line",
                      )}
                    >
                      {stageTotals[c.key] || "—"}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-3">
          A call&apos;s stage is the enquiry&apos;s slot count on the day it was made — §4.3
          counts a slot as a distinct day after the fresh call, so two calls on one
          day share a stage. Fresh calls, 1st, 2nd, 3rd and After-sale together are
          every call once, and add up to Total calls. Call backs, Purchased,
          Competitor and Closed are the same calls cut by outcome: a fresh call that
          ended in a sale is counted in Fresh calls and again in Purchased. 3rd
          includes anything beyond the third slot.
        </p>
      </section>
    </div>
  );
}