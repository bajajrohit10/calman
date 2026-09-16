import { splitContentIds } from "@/lib/call-type";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type {
  AssignmentBucket,
  CallOutcome,
  EnquiryStatus,
  EnquiryType,
  Importance,
} from "@/lib/enquiry-labels";

/**
 * The §6 recommended list. One RPC call — bucketing, the read-time overdue
 * computation, ordering and paging all happen in SQL (see migration 0008), so
 * nothing here reimplements the rule.
 */

export type RecommendedRow = {
  enquiry_id: number;
  bucket: AssignmentBucket;
  bucket_rank: number;
  is_overdue: boolean;
  due_date: string | null;
  student_id: string;
  mobile: string;
  student_name: string | null;
  type: EnquiryType;
  status: EnquiryStatus;
  importance: Importance | null;
  term_id: string | null;
  term_name: string | null;
  source_id: string | null;
  source_name: string | null;
  product_text: string | null;
  next_follow_up_date: string | null;
  created_at: string;
  follow_up_slots_used: number;
  top_content_priority: number | null;
  teacher_names: string[] | null;
  item_count: number;
  assigned_to: string | null;
  assigned_to_name: string | null;
  /** Brief 17: where the lead has got to, and who touched it last. */
  stage: string;
  last_outcome: CallOutcome | null;
  last_called_by: string | null;
  last_called_by_name: string | null;
  assigned_at: string | null;
  /** Brief 19: what a campaign assignment was handed out as, and whether it is done. */
  assignment_label: string | null;
  called_since: boolean;
  /** Brief 18: every offer whose reminder window covers the viewed day. */
  offer_names: string[] | null;
  offer_ids: string[] | null;
  /** Brief 23: an offer lead may be lost, and which kind decides the filter. */
  lost_reason: string | null;
  /** §47.5: video | books | unknown, derived. Stands in for content when none. */
  call_type: string | null;
  /** §48.1: the real arrival — arrived_at when recorded, else created_at. */
  arrived_at: string | null;
  /** §49.2: this lead has interest lines the parser guessed and nobody confirmed. */
  has_auto: boolean | null;
  total_count: number;
};

export type RecommendedFilters = {
  date?: string | null;
  includeNotDue?: boolean;
  counsellorId?: string | null;
  teacherIds?: string[] | null;
  courseId?: string | null;
  subjectId?: string | null;
  contentIds?: string[] | null;
  /** §47.6: several at once, beside the desk's single sourceId. */
  sourceIds?: string[] | null;
  instituteId?: string | null;
  /** Brief 34: institute as a column of options rather than one choice. */
  instituteIds?: string[] | null;
  stages?: string[] | null;
  lastCalledFrom?: string | null;
  lastCalledTo?: string | null;
  termId?: string | null;
  sourceId?: string | null;
  importance?: string[] | null;
  type?: EnquiryType | null;
  status?: EnquiryStatus | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  followUpFrom?: string | null;
  followUpTo?: string | null;
  discussion?: string | null;
  /** 'unassigned' | 'assigned' | null for any. Brief 17; the desk defaults to unassigned. */
  assignment?: string | null;
  lastCalledBy?: string[] | null;
  /** Brief 34: include the leads nobody has ever called. */
  neverCalled?: boolean | null;
  lastOutcomes?: string[] | null;
  /** Facet names whose "No detail" option is selected. */
  noDetail?: string[] | null;
  /** Brief 18: one §6 bucket, and leads matching particular offers. */
  bucket?: string | null;
  offerIds?: string[] | null;
  /**
   * Brief 23: which of open / lost-exhausted / lost-competitor the offer
   * bucket shows. Empty means all three, which is the default.
   */
  offerStatuses?: string[] | null;
  limit?: number;
  offset?: number;
};

type Args = Database["public"]["Functions"]["recommended_calls"]["Args"];

/** Undefined rather than null, so the SQL defaults apply. */
function args(f: RecommendedFilters): Args {
  const clean = <T>(v: T | null | undefined) => (v === null || v === "" ? undefined : v);
  // An empty multi-select widens the filter rather than emptying the list, so
  // it goes as undefined and the SQL default ("any") applies.
  const list = (v: string[] | null | undefined) => (v && v.length ? v : undefined);
  // §47.5. One list on the screen, two parameters on the wire.
  const content = splitContentIds(f.contentIds);
  return {
    p_date: clean(f.date),
    p_include_not_due: f.includeNotDue ?? false,
    p_counsellor_id: clean(f.counsellorId),
    p_teacher_ids: list(f.teacherIds),
    p_course_id: clean(f.courseId),
    p_subject_id: clean(f.subjectId),
    p_content_ids: list(content.real),
    p_source_ids: list(f.sourceIds),
    p_auto_contents: list(content.auto),
    p_institute_id: clean(f.instituteId),
    p_institute_ids: list(f.instituteIds),
    p_stages: f.stages?.length ? f.stages : undefined,
    p_last_called_from: clean(f.lastCalledFrom),
    p_last_called_to: clean(f.lastCalledTo),
    p_term_id: clean(f.termId),
    p_source_id: clean(f.sourceId),
    p_importance: list(f.importance),
    p_type: clean(f.type),
    p_status: clean(f.status),
    p_created_from: clean(f.createdFrom),
    p_created_to: clean(f.createdTo),
    p_follow_up_from: clean(f.followUpFrom),
    p_follow_up_to: clean(f.followUpTo),
    p_discussion: clean(f.discussion),
    p_assignment: clean(f.assignment),
    p_last_called_by: list(f.lastCalledBy),
    p_never_called: f.neverCalled ?? undefined,
    p_last_outcomes: list(f.lastOutcomes),
    p_no_detail: list(f.noDetail),
    p_bucket: clean(f.bucket),
    p_offer_ids: list(f.offerIds),
    p_offer_statuses: list(f.offerStatuses),
    p_limit: f.limit ?? 50,
    p_offset: f.offset ?? 0,
  } as Args;
}

export async function loadRecommended(
  filters: RecommendedFilters,
): Promise<{ rows: RecommendedRow[]; total: number; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recommended_calls", args(filters));

  if (error) return { rows: [], total: 0, error: error.message };
  const rows = (data ?? []) as unknown as RecommendedRow[];
  return { rows, total: rows[0]?.total_count ?? 0, error: null };
}

/**
 * A hard ceiling on "select all matching". Selecting a subset and reporting it
 * as everything would be worse than refusing: the manager would assign 2000 of
 * 3000 leads and have no way of knowing which 1000 were left behind.
 */
export const MAX_SELECT_ALL = 2000;

const SELECT_PAGE = 500;

export type MatchingRow = { enquiryId: number; bucket: AssignmentBucket };

/**
 * Every row matching the filter, ignoring the page — for "select all N
 * matching" on the desk.
 *
 * Returns each row's derived bucket alongside its id, because a selection that
 * spans pages is assigned from this list rather than from what is on screen,
 * and each assignment has to keep the bucket §6 put it in.
 */
export async function loadAllMatching(
  filters: RecommendedFilters,
): Promise<{ rows: MatchingRow[]; total: number; error: string | null }> {
  // One cheap probe for the real total before fetching anything wide.
  const probe = await loadRecommended({ ...filters, limit: 1, offset: 0 });
  if (probe.error) return { rows: [], total: 0, error: probe.error };

  if (probe.total > MAX_SELECT_ALL) {
    return {
      rows: [],
      total: probe.total,
      error: `That is ${probe.total} enquiries — more than the ${MAX_SELECT_ALL} that can be selected at once. Narrow the filter first.`,
    };
  }

  const out: MatchingRow[] = [];
  for (let offset = 0; offset < probe.total; offset += SELECT_PAGE) {
    const page = await loadRecommended({ ...filters, limit: SELECT_PAGE, offset });
    if (page.error) return { rows: [], total: probe.total, error: page.error };
    out.push(
      ...page.rows.map((r) => ({ enquiryId: r.enquiry_id, bucket: r.bucket })),
    );
    if (page.rows.length < SELECT_PAGE) break;
  }

  return { rows: out, total: probe.total, error: null };
}

/**
 * The three headline counts for a day (§36.1): how much work needs handing
 * out, how much is out and still to call, and how much is done.
 *
 * Three calls to the same function the list uses, each asking for one row and
 * reading the window count off it. It would be cheaper as a bespoke query, and
 * that bespoke query would be a fourth definition of "needs assignment" to
 * keep in step with the list, the facets and Smart Assign. Three round trips
 * in parallel is the price of the numbers being the same numbers.
 *
 * Every other filter is passed through unchanged, so the figures move with the
 * filters rather than describing a board nobody is looking at.
 */
export async function loadAssignmentCounts(
  filters: RecommendedFilters,
): Promise<{ needs: number; pending: number; done: number; error: string | null }> {
  const [needs, pending, done] = await Promise.all(
    (["needs", "pending", "done"] as const).map((assignment) =>
      loadRecommended({ ...filters, assignment, limit: 1, offset: 0 }),
    ),
  );

  return {
    needs: needs.total,
    pending: pending.total,
    done: done.total,
    error: needs.error ?? pending.error ?? done.error,
  };
}
