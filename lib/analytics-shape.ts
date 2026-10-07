/**
 * §81, simplified by §82. The analytics shapes, and the pure arithmetic over them.
 *
 * Plain module, not server-only: the view is a client component and these types
 * and helpers reach it. The same split lib/working-days-shape.ts needed, for the
 * same reason — a client component importing a server-only module fails the
 * build, and a type import is too easy to turn into a value import later.
 */

/** §83.2. Which half of the business a table is describing. */
export type Basis = "closed" | "open" | "total";

/**
 * §83.3. The date-range presets, and how each is labelled.
 *
 * Here rather than in the view because the server page resolves the preset into
 * dates and the client renders the chips, so both need the list. A `const` array
 * exported from a "use client" module does not survive the boundary — the server
 * receives a module reference, not an array, and `.includes` is not a function on
 * it. Shared vocabulary belongs in a plain module; this is the same rule that put
 * the types here.
 */
export const RANGE_PRESETS = ["today", "7", "30", "month", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  "7": "Last 7",
  "30": "Last 30",
  month: "This month",
  custom: "Custom",
};

/** §83.3. What a comparison can be. */
export type CompareMode = "none" | "previous" | "custom";

export type AnalyticsFilters = {
  from: string;
  to: string;
  /** §83.3. The comparison window, or null for "no comparison". */
  cmpFrom: string | null;
  cmpTo: string | null;
  courseId: string | null;
  subjectId: string | null;
  /** §85.1. Several at once; an empty list is "any". */
  sourceIds: string[];
  counsellorId: string | null;
  /** §82.2: term left the Products grid and became a filter. */
  termId: string | null;
  /**
   * §84.4. The scope, as a filter on the one basis.
   *
   * The filter bar gains Teacher and Institute so that "the strip filtered to one
   * teacher" is a view somebody can open — which is what makes an experiment card's
   * numbers checkable against the tables below it.
   */
  scopeType: ScopeType;
  scopeId: string | null;
};

/** §84.2. What an experiment can apply to. */
export type ScopeType = "all" | "teacher" | "institute" | "course_subject";

export const SCOPE_LABELS: Record<ScopeType, string> = {
  all: "Everyone",
  teacher: "Teacher",
  institute: "Institute",
  course_subject: "Course · Subject",
};

/** §84.2. One experiment, as the list and the picker read it. */
export type Experiment = {
  id: string;
  note: string;
  metric_note: string | null;
  scope_type: ScopeType;
  scope_id: string | null;
  scope_label: string;
  start_date: string;
  end_date: string | null;
  author: string | null;
};

/** §84.3. One experiment's four windows. `rest` is null on an 'all' scope. */
export type ExperimentResult = {
  id: string;
  note: string;
  metricNote: string | null;
  scopeType: ScopeType;
  scopeId: string | null;
  startDate: string;
  endDate: string | null;
  live: boolean;
  dayN: number;
  dayM: number | null;
  beforeFrom: string;
  beforeTo: string;
  duringFrom: string;
  duringTo: string;
  before: Totals;
  during: Totals;
  rest: Totals | null;
  restBefore: Totals | null;
};

/**
 * §82.1. Every headline figure for one window.
 *
 * The metrics strip shows these for the period and again for the one before it,
 * from one SQL function called twice, so the strip cannot drift from the tables
 * about what "purchased" counts.
 */
export type Totals = {
  leads: number;
  /** §83.1. leads = open + closed, always. */
  open: number;
  closed: number;
  /**
   * §83.1. Leads whose own outcome is won.
   *
   * Not "leads carrying a won line" — `purchasedAnyLine` is that, and it is five
   * higher in the current window because a lead can sell one line and keep
   * others in play. Using it here would put leads in the numerator that are not
   * in the closed denominator, and the five shares would sum to 101.5% instead
   * of 100%.
   */
  purchased: number;
  purchasedAnyLine: number;
  revenue: number;
  wonItems: number;
  wonItemsNoAmount: number;
  lostCompetitor: number;
  lostNotInterested: number;
  lostNoResponse: number;
  lostWrongNumber: number;
  /** Closed but none of the five. Zero on current data; surfaced so the check can fail loudly. */
  closedOther: number;
  /** The open side, by the follow-up now due. These three sum to `open`. */
  atFollowUp1: number;
  atFollowUp2: number;
  atFollowUp3: number;
  overdue: number;
  oldestOpenDays: number;
  called: number;
  uncalled: number;
  lostTotal: number;
};

export type AnalyticsScope = {
  from: string;
  to: string;
  cmpFrom: string | null;
  cmpTo: string | null;
  now: Totals;
  /** Null when no comparison was asked for, so no deltas render at all. */
  prev: Totals | null;
  /** The reconciliation footer's own numbers. */
  taggedLeads: number;
  teacherRows: number;
  untagged: number;
  courseLeads: number;
  courseRows: number;
  untaggedCourse: number;
  bookkeeping: { handedToSupport: number; superseded: number };
};

/**
 * The columns every demand table carries.
 *
 * §82.2 made the Products tab a table rather than a pivot, so teacher, institute
 * and course are now one table at three grains — same columns, same units — and
 * this is the type that says so.
 */
export type DemandMetrics = {
  leads: number;
  prev_leads: number;
  /**
   * §84.1. The comparison window's own outcomes, per row.
   *
   * The Competitor and Conversion heads report a points move on each teacher, and a
   * rate needs both its numerator and its denominator from the other window — a
   * lead count alone cannot produce one.
   */
  prev_closed: number;
  prev_purchased: number;
  prev_lost_competitor: number;
  closed: number;
  open_leads: number;
  purchased: number;
  revenue: number;
  lost_competitor: number;
  lost_not_interested: number;
  lost_no_response: number;
  lost_wrong_number: number;
  items_lost_competitor: number;
  at_fu1: number;
  at_fu2: number;
  at_fu3: number;
  overdue: number;
  oldest_open_days: number;
};

export type TeacherRow = DemandMetrics & {
  teacher_id: string | null;
  teacher_name: string;
  institute_id: string | null;
  institute_name: string | null;
};

export type InstituteRow = DemandMetrics & {
  institute_id: string | null;
  institute_name: string;
};

export type CourseRow = DemandMetrics & {
  course_id: string | null;
  course_name: string;
  subject_id: string | null;
  subject_name: string | null;
};

/** §83.3. One line somebody typed about a change, shown beside the numbers it moved. */
export type AnalyticsEvent = {
  id: string;
  at: string;
  note: string;
  scope: "current" | "comparison";
};

/** §82.2: text, enquiries, purchased — the three things this block is read for. */
export type ProductRow = {
  product: string;
  enquiries: number;
  purchased: number;
};

/**
 * One table row, whatever grain produced it.
 *
 * `id` is null on the Untagged row, which is how every consumer tells the
 * measure-of-what-we-cannot-attribute apart from a real dimension.
 */
export type Row = DemandMetrics & {
  id: string | null;
  label: string;
  /** The institute under a teacher's name, or nothing. */
  sub?: string | null;
  /** Where this row's own enquiry list lives, when it has one. */
  href?: string | null;
};

/** Conversion as a fraction, with the "no leads" case answered rather than NaN. */
export function conversion(purchased: number, enquiries: number): number | null {
  return enquiries > 0 ? purchased / enquiries : null;
}

/** §82.1. Revenue per won line — the unit money is actually recorded in. */
export function avgSale(revenue: number, wonItems: number): number | null {
  return wonItems > 0 ? revenue / wonItems : null;
}

/**
 * §83.1. The five shares of a closed set, and their sum.
 *
 * Returned together because the sum is the check: it must be 100%, and the only
 * way it is not is a closed outcome none of the five names. Shown in the strip's
 * tooltip for exactly that reason.
 */
export function closedShares(t: {
  closed: number;
  purchased: number;
  lostCompetitor: number;
  lostNotInterested: number;
  lostNoResponse: number;
  lostWrongNumber: number;
  closedOther?: number;
}): {
  purchased: number | null;
  competitor: number | null;
  notInterested: number | null;
  noResponse: number | null;
  wrongNumber: number | null;
  other: number | null;
  sum: number | null;
} {
  const d = t.closed;
  const r = (n: number) => (d > 0 ? n / d : null);
  const parts = [
    t.purchased,
    t.lostCompetitor,
    t.lostNotInterested,
    t.lostNoResponse,
    t.lostWrongNumber,
    t.closedOther ?? 0,
  ];
  return {
    purchased: r(t.purchased),
    competitor: r(t.lostCompetitor),
    notInterested: r(t.lostNotInterested),
    noResponse: r(t.lostNoResponse),
    wrongNumber: r(t.lostWrongNumber),
    other: r(t.closedOther ?? 0),
    sum: d > 0 ? parts.reduce((a, b) => a + b, 0) / d : null,
  };
}

/** The decided outcomes of one table row — which on this basis is simply `closed`. */
export function decided(r: DemandMetrics): number {
  return r.closed;
}

/**
 * The period-on-period change, or null when there is no basis for one.
 *
 * Null when the previous window had nothing: every percentage against zero is
 * infinite, and "▲∞%" on a teacher who is simply new tells a manager less than
 * a dash does. All of this project's lead data begins on 26 Sep 2026, so on any
 * window reaching back further than that this is the common case rather than the
 * edge one — which is also why the rising and falling insight rules are dormant.
 */
export function change(now: number, before: number): number | null {
  return before > 0 ? (now - before) / before : null;
}

/**
 * §83.3. A rate's movement is in percentage points, not percent.
 *
 * 24% to 29% is five points up. Calling it "+21%" — which is what the ratio
 * gives — is true of the ratio and misleading about the business, and it is the
 * single most common way a dashboard lies about a conversion rate.
 */
export function pointsChange(now: number | null, before: number | null): number | null {
  if (now === null || before === null) return null;
  return (now - before) * 100;
}
