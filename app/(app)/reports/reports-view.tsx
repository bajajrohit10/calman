"use client";

import Link from "next/link";

import { ExportButton } from "@/components/export-button";
import { Button, ErrorNote, Input, Select, cx } from "@/components/ui";
import { formatDate, istDatePlus, istToday, istWeekStart } from "@/lib/format";
import {
  CALL_REPORT_COLUMNS,
  CALL_REPORT_GROUPS,
  formatReportCell,
  type CallReportRow,
} from "@/lib/report-shape";

/**
 * §5.8. Two tables, one column layout: the same range cut by day and by
 * counsellor, with identical columns so a number can be read across from one
 * to the other and the two Total rows must agree.
 *
 * Group A counts every call once by what kind of call it was, group B counts
 * the same calls once by how they ended. Total calls and Total outcomes are
 * therefore the same number on every row; when they are not, the row says so
 * in red rather than quietly printing two different answers.
 */

/** Monday of the week before this one, to today's weekday equivalent. */
function lastWeek(): { from: string; to: string } {
  const start = istWeekStart();
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  const from = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { from, to: d.toISOString().slice(0, 10) };
}

function rangePresets() {
  const today = istToday();
  const prev = lastWeek();
  return [
    { label: "Today", from: today, to: today },
    { label: "This week", from: istWeekStart(), to: today },
    { label: "Last week", from: prev.from, to: prev.to },
    { label: "Last 30 days", from: istDatePlus(-29), to: today },
  ];
}

function ReportTable({
  caption,
  firstHeader,
  rows,
  labelOf,
  emptyNote,
}: {
  caption: string;
  firstHeader: string;
  rows: CallReportRow[];
  labelOf: (row: CallReportRow) => string;
  emptyNote: string;
}) {
  const body = rows.filter((r) => !r.is_total);
  const total = rows.find((r) => r.is_total) ?? null;

  return (
    <section>
      <h2 className="mb-1.5 text-[13px] font-semibold text-ink">{caption}</h2>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[1180px] border-collapse text-[12.5px]">
          <thead>
            {/* The group band. The two totals sit at the end of their own
                group, so which columns add up to which total is visible
                rather than something you have to be told. */}
            <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-1.5 py-[6px]" />
              {CALL_REPORT_GROUPS.map((g) => (
                <th
                  key={g.id}
                  colSpan={g.columns.length}
                  className="border-l border-line px-1.5 py-[6px] text-center"
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-2 py-[7px] whitespace-nowrap">{firstHeader}</th>
              {CALL_REPORT_GROUPS.map((g) =>
                g.columns.map((c, i) => (
                  <th
                    key={c.key}
                    className={cx(
                      "px-1.5 py-[7px] text-right",
                      i === 0 && "border-l border-line",
                      c.isTotal && "text-ink-2",
                    )}
                  >
                    {c.label}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {body.map((row) => (
              <tr
                key={row.grain_key ?? labelOf(row)}
                className="border-b border-line last:border-b-0"
              >
                <td className="px-2 py-[5px] whitespace-nowrap text-ink">
                  {labelOf(row)}
                </td>
                {CALL_REPORT_GROUPS.map((g) =>
                  g.columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={cx(
                        "px-1.5 py-[5px] text-right tabular-nums",
                        i === 0 && "border-l border-line",
                        // One colour class per cell: two of them have equal
                        // specificity and Tailwind's own ordering would decide
                        // which wins, which is not a decision to leave to it.
                        c.isTotal && row.mismatch
                          ? "font-medium text-danger"
                          : c.isTotal
                            ? "font-medium text-ink"
                            : "text-ink-2",
                      )}
                      title={
                        c.isTotal && row.mismatch
                          ? "Type and outcome totals disagree on this row."
                          : undefined
                      }
                    >
                      {formatReportCell(c, Number(row[c.key] ?? 0))}
                      {c.key === "total_outcomes" && row.mismatch ? " ⚠" : ""}
                    </td>
                  )),
                )}
              </tr>
            ))}
            {body.length === 0 ? (
              <tr>
                <td
                  colSpan={CALL_REPORT_COLUMNS.length + 1}
                  className="px-3 py-8 text-center text-ink-3"
                >
                  {emptyNote}
                </td>
              </tr>
            ) : null}
          </tbody>
          {total ? (
            <tfoot>
              <tr className="border-t-2 border-line bg-sunk/30">
                <td className="px-2 py-[6px] font-semibold text-ink">Total</td>
                {CALL_REPORT_GROUPS.map((g) =>
                  g.columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={cx(
                        "px-1.5 py-[6px] text-right font-semibold tabular-nums",
                        i === 0 && "border-l border-line",
                        c.isTotal && total.mismatch ? "text-danger" : "text-ink",
                      )}
                    >
                      {formatReportCell(c, Number(total[c.key] ?? 0))}
                      {c.key === "total_outcomes" && total.mismatch ? " ⚠" : ""}
                    </td>
                  )),
                )}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}

export function ReportsView({
  byDay,
  byCounsellor,
  error,
  from,
  to,
  isAdmin,
  counsellorId,
  roster,
}: {
  byDay: CallReportRow[];
  byCounsellor: CallReportRow[];
  error: string | null;
  from: string;
  to: string;
  isAdmin: boolean;
  counsellorId: string | null;
  roster: { id: string; name: string }[];
}) {
  const mismatched = [...byDay, ...byCounsellor].some((r) => r.mismatch);

  return (
    <div className="flex flex-col gap-4">
      <form method="GET" className="rounded-lg border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-end gap-3 p-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              From
            </span>
            <Input type="date" name="from" defaultValue={from} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              To
            </span>
            <Input type="date" name="to" defaultValue={to} />
          </label>
          {isAdmin ? (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
                Counsellor
              </span>
              <Select
                name="counsellor"
                defaultValue={counsellorId ?? ""}
                className="w-[190px]"
              >
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
          <div className="ml-auto">
            <ExportButton
              source="report"
              from={from}
              to={to}
              counsellorId={counsellorId}
            />
          </div>
        </div>
        {/* The ranges anyone actually asks for, one click each. The pickers
            above stay for everything else. */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-2.5 py-2 text-[12px]">
          {rangePresets().map((p) => {
            const params = new URLSearchParams({ from: p.from, to: p.to });
            if (counsellorId) params.set("counsellor", counsellorId);
            const current = p.from === from && p.to === to;
            return (
              <Link
                key={p.label}
                href={`/reports?${params.toString()}`}
                className={cx(
                  "rounded-full border px-2.5 py-[3px]",
                  current
                    ? "border-accent/40 bg-accent-soft text-accent"
                    : "border-line-2 bg-surface-2 text-ink-2 hover:text-ink",
                )}
              >
                {p.label}
              </Link>
            );
          })}
          <span className="ml-auto text-[11.5px] text-ink-3">
            {formatDate(from)} — {formatDate(to)}
          </span>
        </div>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {mismatched ? (
        <ErrorNote>
          A row&apos;s Total calls and Total outcomes disagree (marked ⚠). Every call
          is counted once in each group, so this means an outcome exists that the
          report does not classify — the numbers below are understated until it is
          added.
        </ErrorNote>
      ) : null}

      <ReportTable
        caption="By day"
        firstHeader="Date"
        rows={byDay}
        labelOf={(r) => formatDate(r.grain_label)}
        emptyNote="No days in this range."
      />

      <ReportTable
        caption="By counsellor"
        firstHeader="Counsellor"
        rows={byCounsellor}
        labelOf={(r) => r.grain_label}
        emptyNote="Nobody active in this range."
      />

      <p className="text-[11.5px] leading-relaxed text-ink-3">
        A call is counted once in <strong>Calls by type</strong> and once in{" "}
        <strong>Calls by outcome</strong>, so the two totals always match. Type is
        decided in order: an after-sale call is a Ticket whatever it was assigned
        as; otherwise a call assigned that day as an offer is an Offer and one
        assigned as a campaign is Customised; everything left, including calls
        nobody was assigned, goes by §4.3 slot — first-ever call is a New call, then
        1st, 2nd and 3rd follow-up, where a slot is a distinct day after the fresh
        call and anything past the third counts as 3rd. After-sale collects the
        noted, escalated and resolved outcomes. Purchase amount is the value of
        items won on that day, credited to the counsellor whose purchased call won
        them. PLI issued counts leads re-graded to A by a person, excluding imports.
      </p>
    </div>
  );
}
