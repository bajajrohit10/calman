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

/**
 * §5.8 stage-wise report, one row per counsellor per day.
 *
 * The stage columns partition every call: fresh_calls + follow_up_1 + _2 + _3
 * + after_sale_calls = total_calls, always. The memo columns cut the same
 * calls by outcome and deliberately overlap the stage columns, so they are
 * kept in a separate list — adding them into the total would double-count.
 */
export type StageRow = {
  day: string;
  counsellor_id: string;
  counsellor_name: string | null;
  fresh_calls: number;
  follow_up_1: number;
  follow_up_2: number;
  follow_up_3: number;
  after_sale_calls: number;
  total_calls: number;
  call_backs: number;
  purchased: number;
  competitor: number;
  closed: number;
};

export const STAGE_COLUMNS = [
  { key: "fresh_calls", label: "Fresh calls" },
  { key: "follow_up_1", label: "1st follow-up" },
  { key: "follow_up_2", label: "2nd" },
  { key: "follow_up_3", label: "3rd" },
  { key: "after_sale_calls", label: "After-sale calls" },
  { key: "total_calls", label: "Total calls" },
] as const;

export const STAGE_MEMO_COLUMNS = [
  { key: "call_backs", label: "Call backs" },
  { key: "purchased", label: "Purchased" },
  { key: "competitor", label: "Competitor" },
  { key: "closed", label: "Closed" },
] as const;

export type StageMetric =
  | (typeof STAGE_COLUMNS)[number]["key"]
  | (typeof STAGE_MEMO_COLUMNS)[number]["key"];

export const ALL_STAGE_METRICS: StageMetric[] = [
  ...STAGE_COLUMNS.map((c) => c.key),
  ...STAGE_MEMO_COLUMNS.map((c) => c.key),
];

export type Grain = "day" | "week" | "month";

/**
 * The team summary: the same per-counsellor-per-day rows, totalled.
 *
 * Every metric is a count or a sum, so grouping them here is exact and saves a
 * second SQL implementation that could disagree with the first.
 */
export function groupRowsByGrain<K extends string>(
  rows: ({ day: string } & Record<K, unknown>)[],
  grain: Grain,
  keys: readonly K[],
): { bucket: string; totals: Record<K, number> }[] {
  const out = new Map<string, Record<K, number>>();

  for (const row of rows) {
    const key = bucketOf(row.day, grain);
    const acc =
      out.get(key) ??
      (Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>);
    for (const k of keys) {
      acc[k] += Number(row[k] ?? 0);
    }
    out.set(key, acc);
  }

  return [...out.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, totals]) => ({ bucket, totals }));
}

export function groupByGrain(
  rows: ReportRow[],
  grain: Grain,
): { bucket: string; totals: Record<ReportMetric, number> }[] {
  return groupRowsByGrain(
    rows,
    grain,
    REPORT_COLUMNS.map((c) => c.key),
  );
}

export function groupStageByGrain(
  rows: StageRow[],
  grain: Grain,
): { bucket: string; totals: Record<StageMetric, number> }[] {
  return groupRowsByGrain(rows, grain, ALL_STAGE_METRICS);
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
