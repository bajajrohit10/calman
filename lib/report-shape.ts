/**
 * The report's shape and its client-side grouping.
 *
 * Split from lib/reports.ts because the Reports view imports REPORT_COLUMNS as
 * a value, and that file is server-only — importing it from a client component
 * pulls "server-only" into the browser bundle and the build refuses.
 */
/** §5.8, one row per counsellor per day. */
export type ReportRow = {
  day: string;
  counsellor_id: string;
  counsellor_name: string | null;
  calls_made: number;
  fresh_handled: number;
  follow_ups_done: number;
  call_backs: number;
  purchased_calls: number;
  purchased_amount: number;
  competitor: number;
  closed: number;
  pli_issued: number;
  overdue_carried_forward: number;
};

export const REPORT_COLUMNS = [
  { key: "calls_made", label: "Calls made" },
  { key: "fresh_handled", label: "Fresh handled" },
  { key: "follow_ups_done", label: "Follow-ups done" },
  { key: "call_backs", label: "Call backs" },
  { key: "purchased_calls", label: "Purchased" },
  { key: "purchased_amount", label: "Amount" },
  { key: "competitor", label: "Competitor" },
  { key: "closed", label: "Closed" },
  { key: "pli_issued", label: "PLI issued" },
  { key: "overdue_carried_forward", label: "Overdue carried" },
] as const;

export type ReportMetric = (typeof REPORT_COLUMNS)[number]["key"];

export type Grain = "day" | "week" | "month";

/**
 * The team summary: the same per-counsellor-per-day rows, totalled.
 *
 * Every metric is a count or a sum, so grouping them here is exact and saves a
 * second SQL implementation that could disagree with the first.
 */
export function groupByGrain(
  rows: ReportRow[],
  grain: Grain,
): { bucket: string; totals: Record<ReportMetric, number> }[] {
  const out = new Map<string, Record<ReportMetric, number>>();

  for (const row of rows) {
    const key = bucketOf(row.day, grain);
    const acc =
      out.get(key) ??
      (Object.fromEntries(REPORT_COLUMNS.map((c) => [c.key, 0])) as Record<
        ReportMetric,
        number
      >);
    for (const c of REPORT_COLUMNS) {
      acc[c.key] += Number(row[c.key] ?? 0);
    }
    out.set(key, acc);
  }

  return [...out.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, totals]) => ({ bucket, totals }));
}

/** ISO week starting Monday, so a week never straddles two labels. */
function bucketOf(day: string, grain: Grain): string {
  if (grain === "day") return day;
  if (grain === "month") return day.slice(0, 7);

  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return `week of ${d.toISOString().slice(0, 10)}`;
}
