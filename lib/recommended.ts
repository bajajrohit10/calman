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
  instituteId?: string | null;
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
  lastOutcomes?: string[] | null;
  /** Facet names whose "No detail" option is selected. */
  noDetail?: string[] | null;
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
  return {
    p_date: clean(f.date),
    p_include_not_due: f.includeNotDue ?? false,
    p_counsellor_id: clean(f.counsellorId),
    p_teacher_ids: list(f.teacherIds),
    p_course_id: clean(f.courseId),
    p_subject_id: clean(f.subjectId),
    p_content_ids: list(f.contentIds),
    p_institute_id: clean(f.instituteId),
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
    p_last_outcomes: list(f.lastOutcomes),
    p_no_detail: list(f.noDetail),
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
