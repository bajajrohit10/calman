/**
 * §81. The analytics shapes, and the pure arithmetic over them.
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
};

/** The page's own totals: the header line, the footer, and what the rules compare against. */
export type AnalyticsScope = {
  from: string;
  to: string;
  days: number;
  prevFrom: string;
  prevTo: string;
  leads: number;
  taggedLeads: number;
  teacherRows: number;
  untagged: number;
  courseLeads: number;
  pivotCells: number;
  untaggedCourse: number;
  uncalled: number;
  uncalledUntagged: number;
  bookkeeping: { handedToSupport: number; superseded: number };
  purchasedLeads: number;
  teamConversion: number;
  revenue: number;
  wonItems: number;
  wonItemsNoAmount: number;
  lostTotal: number;
  lostNoResponse: number;
};

/** One row of the teacher or institute table. `teacherId` is null on the Untagged row. */
export type DemandRow = {
  teacher_id?: string | null;
  teacher_name?: string;
  institute_id: string | null;
  institute_name: string | null;
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
  tickets: number;
};

export type PivotRow = {
  course_id: string;
  course_name: string;
  course_sort: number;
  subject_id: string | null;
  subject_name: string;
  subject_sort: number;
  term_id: string | null;
  term_name: string;
  term_sort: number;
  enquiries: number;
  prev_enquiries: number;
  purchased: number;
  revenue: number;
};

export type ProductRow = {
  product: string;
  enquiries: number;
  purchased: number;
  revenue: number;
};

/** Conversion as a fraction, with the "no leads" case answered rather than NaN. */
export function conversion(purchased: number, enquiries: number): number | null {
  return enquiries > 0 ? purchased / enquiries : null;
}

/**
 * Tickets per ten sales, or null when there were no sales.
 *
 * Null rather than Infinity: "three tickets and nothing sold" is a real and
 * worrying state, but it is not a *rate*, and printing ∞ in a column somebody
 * sorts on is how a table becomes unsortable.
 */
export function ticketsPer10(tickets: number, purchased: number): number | null {
  return purchased > 0 ? (tickets / purchased) * 10 : null;
}

/** The four Lost columns plus Purchased: the outcomes that have actually been decided. */
export function decided(r: DemandRow): number {
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
 * edge one.
 */
export function change(now: number, before: number): number | null {
  return before > 0 ? (now - before) / before : null;
}
