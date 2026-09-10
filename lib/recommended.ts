import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type {
  AssignmentBucket,
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
  total_count: number;
};

export type RecommendedFilters = {
  date?: string | null;
  includeNotDue?: boolean;
  counsellorId?: string | null;
  teacherId?: string | null;
  courseId?: string | null;
  subjectId?: string | null;
  contentId?: string | null;
  termId?: string | null;
  sourceId?: string | null;
  importance?: Importance | null;
  type?: EnquiryType | null;
  status?: EnquiryStatus | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  followUpFrom?: string | null;
  followUpTo?: string | null;
  discussion?: string | null;
  limit?: number;
  offset?: number;
};

type Args = Database["public"]["Functions"]["recommended_calls"]["Args"];

/** Undefined rather than null, so the SQL defaults apply. */
function args(f: RecommendedFilters): Args {
  const clean = <T>(v: T | null | undefined) => (v === null || v === "" ? undefined : v);
  return {
    p_date: clean(f.date),
    p_include_not_due: f.includeNotDue ?? false,
    p_counsellor_id: clean(f.counsellorId),
    p_teacher_id: clean(f.teacherId),
    p_course_id: clean(f.courseId),
    p_subject_id: clean(f.subjectId),
    p_content_id: clean(f.contentId),
    p_term_id: clean(f.termId),
    p_source_id: clean(f.sourceId),
    p_importance: clean(f.importance),
    p_type: clean(f.type),
    p_status: clean(f.status),
    p_created_from: clean(f.createdFrom),
    p_created_to: clean(f.createdTo),
    p_follow_up_from: clean(f.followUpFrom),
    p_follow_up_to: clean(f.followUpTo),
    p_discussion: clean(f.discussion),
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

/** Every enquiry id matching the filter, ignoring the page — for "select all". */
export async function loadRecommendedIds(
  filters: RecommendedFilters,
): Promise<number[]> {
  const { rows } = await loadRecommended({ ...filters, limit: 1000, offset: 0 });
  return rows.map((r) => r.enquiry_id);
}
