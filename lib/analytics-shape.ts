/**
 * §81, simplified by §82. The analytics shapes, and the pure arithmetic over them.
 *
 * Plain module, not server-only: the view is a client component and these types
 * and helpers reach it. The same split lib/working-days-shape.ts needed, for the
 * same reason — a client component importing a server-only module fails the
 * build, and a type import is too easy to turn into a value import later.
 */

export type AnalyticsFilters = {
  from: string;
  to: string;
  courseId: string | null;
  subjectId: string | null;
  sourceId: string | null;
  counsellorId: string | null;
  /** §82.2: term left the Products grid and became a filter. */
  termId: string | null;
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
  called: number;
  uncalled: number;
  purchased: number;
  revenue: number;
  wonItems: number;
  wonItemsNoAmount: number;
  openFollowUps: number;
  lostCompetitor: number;
  lostNotInterested: number;
  lostNoResponse: number;
  lostWrongNumber: number;
  lostTotal: number;
};

export type AnalyticsScope = {
  from: string;
  to: string;
  days: number;
  prevFrom: string;
  prevTo: string;
  now: Totals;
  prev: Totals;
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
  enquiries: number;
  prev_enquiries: number;
  in_progress: number;
  purchased: number;
  amount: number;
  lost_competitor: number;
  lost_not_interested: number;
  lost_no_response: number;
  lost_wrong_number: number;
  items_lost_competitor: number;
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

/** The four Lost columns plus Purchased: the outcomes that have actually been decided. */
export function decided(r: DemandMetrics): number {
  return (
    r.purchased +
    r.lost_competitor +
    r.lost_not_interested +
    r.lost_no_response +
    r.lost_wrong_number
  );
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
