import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  AssignmentBucket,
  CallOutcome,
  CloseReason,
  EnquiryStatus,
  EnquiryType,
  Importance,
  IssueCategory,
  ItemStatus,
  LeadVerification,
  LostReason,
} from "@/lib/enquiry-labels";

/**
 * One student's entire record: every enquiry, every call under it, every item
 * and every assignment. §5.2 is explicit that nothing is hidden here, so this
 * loader deliberately has no filters and no pagination — a student has a
 * handful of enquiries, not a feed.
 *
 * Shared by /students/[mobile] and the Quick Add lookup, so the history panel
 * inside Quick Add is the same component and the same data as the full page.
 */

export type HistoryCall = {
  id: number;
  called_at: string;
  call_date: string;
  outcome: CallOutcome;
  discussion: string | null;
  next_follow_up_date: string | null;
  whatsapp_sent: boolean;
  issue_category: IssueCategory | null;
  order_id: string | null;
  caller: { full_name: string | null } | null;
};

export type HistoryItem = {
  id: string;
  status: ItemStatus;
  order_id: string | null;
  amount: number | null;
  teacher: { name: string } | null;
  course: { name: string } | null;
  subject: { name: string } | null;
  content: { name: string } | null;
};

export type HistorySend = {
  id: number;
  message_text: string;
  sent_at: string;
  template: { name: string } | null;
  sender: { full_name: string | null } | null;
};

export type HistoryAssignment = {
  id: string;
  date: string;
  bucket: AssignmentBucket;
  counsellor: { full_name: string | null } | null;
};

export type HistoryEnquiry = {
  id: number;
  type: EnquiryType;
  status: EnquiryStatus;
  /** §9: set means the enquiry has left every working list but is still here. */
  archived_at: string | null;
  re_enquired_at: string | null;
  /** §10.1: every source this number arrived through, newest first. */
  enquiry_sources: {
    id: string;
    occurred_at: string;
    note: string | null;
    source: { name: string } | null;
  }[];
  product_text: string | null;
  importance: Importance | null;
  lead_verification: LeadVerification | null;
  lost_reason: LostReason | null;
  close_reason: CloseReason | null;
  next_follow_up_date: string | null;
  term_id: string | null;
  source_id: string | null;
  fresh_call_date: string | null;
  follow_up_slots_used: number;
  created_at: string;
  closed_at: string | null;
  source: { name: string } | null;
  term: { name: string } | null;
  calls: HistoryCall[];
  enquiry_items: HistoryItem[];
  assignments: HistoryAssignment[];
  whatsapp_sends: HistorySend[];
};

export type StudentHistory = {
  id: string;
  mobile: string;
  name: string | null;
  created_at: string;
  enquiries: HistoryEnquiry[];
};

const SELECT = `
  id, mobile, name, created_at,
  enquiries (
    id, type, status, product_text, importance, lead_verification,
    lost_reason, close_reason, next_follow_up_date, term_id, source_id, fresh_call_date,
    follow_up_slots_used, created_at, closed_at, archived_at, re_enquired_at,
    source:sources ( name ),
    term:terms ( name ),
    enquiry_sources (
      id, occurred_at, note,
      source:sources ( name )
    ),
    calls!calls_enquiry_id_fkey (
      id, called_at, call_date, outcome, discussion, next_follow_up_date,
      whatsapp_sent, issue_category, order_id,
      caller:profiles!calls_called_by_fkey ( full_name )
    ),
    enquiry_items (
      id, status, order_id, amount,
      teacher:teachers ( name ),
      course:courses ( name ),
      subject:subjects ( name ),
      content:contents ( name )
    ),
    assignments (
      id, date, bucket,
      counsellor:profiles!assignments_counsellor_id_fkey ( full_name )
    ),
    whatsapp_sends (
      id, message_text, sent_at,
      template:whatsapp_templates ( name ),
      sender:profiles!whatsapp_sends_sent_by_fkey ( full_name )
    )
  )
`;

/**
 * Newest enquiry first, newest call first within each (§5.2 "stacked").
 * Sorted here rather than in PostgREST: the nested ordering syntax buys
 * nothing at these volumes and reads far worse.
 */
function sortHistory(student: StudentHistory): StudentHistory {
  const enquiries = [...student.enquiries].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
  );

  for (const enquiry of enquiries) {
    enquiry.calls.sort(
      (a, b) => Date.parse(b.called_at) - Date.parse(a.called_at) || b.id - a.id,
    );
    enquiry.assignments.sort((a, b) => b.date.localeCompare(a.date));
    enquiry.whatsapp_sends.sort(
      (a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at) || b.id - a.id,
    );
  }

  return { ...student, enquiries };
}

/** null when the number has never been seen. */
export async function loadStudentByMobile(
  mobile: string,
): Promise<StudentHistory | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .select(SELECT)
    .eq("mobile", mobile)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return sortHistory(data as unknown as StudentHistory);
}

/** The enquiry Quick Add would offer to update: the open one, newest first. */
export function openEnquiryOf(student: StudentHistory): HistoryEnquiry | null {
  return student.enquiries.find((e) => e.status === "open") ?? null;
}
