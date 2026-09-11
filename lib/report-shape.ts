/**
 * §5.8. One column layout, used by both report tables and by the export.
 *
 * Split from lib/reports.ts because the Reports view imports the column lists
 * as values, and that file is server-only — importing it from a client
 * component pulls "server-only" into the browser bundle and the build refuses.
 *
 * The three tables this replaced each cut the same calls a different way, and
 * none of them added up to the others, so "how many calls did we make" had
 * three answers depending on which table you read. There is now one
 * classification and two ways of grouping it: per day, and per counsellor.
 */

/** One row of public.call_report, at either grain. */
export type CallReportRow = {
  /** The day (yyyy-mm-dd) or the counsellor id; null on the Total row. */
  grain_key: string | null;
  /** What the first cell prints. */
  grain_label: string;
  is_total: boolean;
  // A. calls by type
  new_calls: number;
  offers: number;
  follow_up_1: number;
  follow_up_2: number;
  follow_up_3: number;
  customised: number;
  tickets: number;
  total_calls: number;
  // B. calls by outcome
  out_follow_up: number;
  out_call_back: number;
  out_purchased: number;
  out_competitor: number;
  out_closed: number;
  out_after_sale: number;
  total_outcomes: number;
  // C. results
  customers_purchased: number;
  purchase_amount: number;
  pli_issued: number;
  /** True when A and B disagree — see CALL_REPORT_GROUPS below. */
  mismatch: boolean;
};

export type CallReportColumn = {
  key: CallReportMetric;
  label: string;
  /** Totals are bold and carry the group's dividing line. */
  isTotal?: boolean;
  /** Rendered as rupees rather than a count. */
  money?: boolean;
};

export type CallReportGroup = {
  id: "type" | "outcome" | "results";
  label: string;
  columns: CallReportColumn[];
};

/**
 * The column layout. Group A classifies every call exactly once by what kind
 * of call it was; group B classifies the same calls exactly once by how they
 * ended. Two partitions of one set, so TOTAL CALLS and TOTAL OUTCOMES must be
 * equal on every row — the RPC carries `mismatch` per row and the screen marks
 * it, because a silent disagreement is how the old report drifted.
 */
export const CALL_REPORT_GROUPS: CallReportGroup[] = [
  {
    id: "type",
    label: "Calls by type",
    columns: [
      { key: "new_calls", label: "New calls" },
      { key: "offers", label: "Offers" },
      { key: "follow_up_1", label: "1st follow-up" },
      { key: "follow_up_2", label: "2nd follow-up" },
      { key: "follow_up_3", label: "3rd follow-up" },
      { key: "customised", label: "Customised" },
      { key: "tickets", label: "Tickets" },
      { key: "total_calls", label: "Total calls", isTotal: true },
    ],
  },
  {
    id: "outcome",
    label: "Calls by outcome",
    columns: [
      { key: "out_follow_up", label: "Follow up" },
      { key: "out_call_back", label: "Call back" },
      { key: "out_purchased", label: "Purchased" },
      { key: "out_competitor", label: "Competitor" },
      { key: "out_closed", label: "Closed" },
      { key: "out_after_sale", label: "After-sale" },
      { key: "total_outcomes", label: "Total outcomes", isTotal: true },
    ],
  },
  {
    id: "results",
    label: "Results",
    columns: [
      { key: "customers_purchased", label: "Customers purchased" },
      { key: "purchase_amount", label: "Purchase amount", money: true },
      { key: "pli_issued", label: "PLI issued" },
    ],
  },
];

export type CallReportMetric =
  | "new_calls"
  | "offers"
  | "follow_up_1"
  | "follow_up_2"
  | "follow_up_3"
  | "customised"
  | "tickets"
  | "total_calls"
  | "out_follow_up"
  | "out_call_back"
  | "out_purchased"
  | "out_competitor"
  | "out_closed"
  | "out_after_sale"
  | "total_outcomes"
  | "customers_purchased"
  | "purchase_amount"
  | "pli_issued";

/** Every metric column, in screen order. Both tables and both exports use it. */
export const CALL_REPORT_COLUMNS: CallReportColumn[] = CALL_REPORT_GROUPS.flatMap(
  (g) => g.columns,
);

/** Rupees with the Indian digit grouping; a zero prints as an em dash. */
export function formatReportCell(column: CallReportColumn, value: number): string {
  if (column.money) {
    return Number(value) ? `₹${Number(value).toLocaleString("en-IN")}` : "—";
  }
  return Number(value) ? String(Number(value)) : "—";
}
