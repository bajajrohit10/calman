import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  CallOutcome,
  CloseReason,
  EnquiryStatus,
  EnquiryType,
  Importance,
  LeadVerification,
  LostReason,
} from "@/lib/enquiry-labels";

/** §5.6. One row per enquiry, whatever its status. */
export type EnquiryRow = {
  enquiry_id: number;
  student_id: string;
  mobile: string;
  student_name: string | null;
  type: EnquiryType;
  status: EnquiryStatus;
  lost_reason: LostReason | null;
  close_reason: CloseReason | null;
  importance: Importance | null;
  lead_verification: LeadVerification | null;
  term_name: string | null;
  source_name: string | null;
  product_text: string | null;
  next_follow_up_date: string | null;
  fresh_call_date: string | null;
  follow_up_slots_used: number;
  created_at: string;
  closed_at: string | null;
  item_count: number;
  teacher_names: string | null;
  last_call_at: string | null;
  last_outcome: CallOutcome | null;
  last_discussion: string | null;
  assigned_to_name: string | null;
  assigned_date: string | null;
  total_count: number;
};

export type EnquiryFilters = {
  type?: EnquiryType | null;
  status?: EnquiryStatus | null;
  lostReason?: LostReason | null;
  closeReason?: CloseReason | null;
  counsellorId?: string | null;
  teacherId?: string | null;
  courseId?: string | null;
  subjectId?: string | null;
  contentId?: string | null;
  termId?: string | null;
  sourceId?: string | null;
  importance?: Importance | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  followUpFrom?: string | null;
  followUpTo?: string | null;
  discussion?: string | null;
  mobile?: string | null;
  includeArchived?: boolean;
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

const clean = <T>(v: T | null | undefined) => (v === null || v === "" ? undefined : v);

export async function loadEnquiries(
  f: EnquiryFilters,
): Promise<{ rows: EnquiryRow[]; total: number; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enquiries_table", {
    p_type: clean(f.type),
    p_status: clean(f.status),
    p_lost_reason: clean(f.lostReason),
    p_close_reason: clean(f.closeReason),
    p_counsellor_id: clean(f.counsellorId),
    p_teacher_id: clean(f.teacherId),
    p_course_id: clean(f.courseId),
    p_subject_id: clean(f.subjectId),
    p_content_id: clean(f.contentId),
    p_term_id: clean(f.termId),
    p_source_id: clean(f.sourceId),
    p_importance: clean(f.importance),
    p_created_from: clean(f.createdFrom),
    p_created_to: clean(f.createdTo),
    p_follow_up_from: clean(f.followUpFrom),
    p_follow_up_to: clean(f.followUpTo),
    p_discussion: clean(f.discussion),
    p_mobile: clean(f.mobile),
    p_include_archived: f.includeArchived ?? false,
    p_sort: f.sort ?? "created_at",
    p_dir: f.dir ?? "desc",
    p_limit: f.limit ?? 50,
    p_offset: f.offset ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { rows: [], total: 0, error: error.message };
  const rows = (data ?? []) as unknown as EnquiryRow[];
  return { rows, total: rows[0]?.total_count ?? 0, error: null };
}
