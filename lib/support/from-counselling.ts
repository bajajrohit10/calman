import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * §62.2. Raising a support ticket from the counselling side.
 *
 * Two doors lead here — a counsellor saying "this is an after-sale call" on a
 * lead, and a call logged on an enquiry that is already in the old after-sale
 * pipeline — and both want the same thing: one ticket, in Support, with the
 * counselling enquiry named on it and nothing mirrored back.
 *
 * The work itself is one SQL function, so the ticket and the enquiry's closure
 * are a single transaction. A closed enquiry with no ticket is work lost; a
 * ticket with an open enquiry behind it is the same complaint in two queues.
 */

export type RaiseFromCounselling = {
  studentId: string;
  /** The counselling enquiry to name on the ticket, and to close. */
  enquiryId?: number | null;
  orderId?: string | null;
  discussion?: string | null;
  /** public.issue_category, as text. */
  issueCategory?: string | null;
  outcome: "noted" | "working" | "escalated" | "pending_institute" | "resolved";
  followUpDate?: string | null;
  /** Named in the opening note only; Support tracks its own escalations. */
  escalatedTo?: string | null;
  teacherId?: string | null;
  /** False from Quick Add, where the linked enquiry is a won one to keep. */
  closeEnquiry: boolean;
};

export type RaisedTicket = {
  ticketId: number;
  status: string;
  /** An open ticket the number already had. Named, never merged into (§62.2). */
  existingOpenTicket: number | null;
  closedEnquiry: boolean;
};

export async function raiseTicketFromCounselling(
  base: SupabaseClient<Database>,
  input: RaiseFromCounselling,
): Promise<{ error: string | null; raised?: RaisedTicket }> {
  const { data, error } = await base.schema("support").rpc("raise_from_counselling", {
    p_student_id: input.studentId,
    p_enquiry_id: input.enquiryId ?? null,
    p_order_id: input.orderId ?? null,
    p_discussion: input.discussion ?? null,
    p_issue_category: input.issueCategory ?? null,
    p_outcome: input.outcome,
    p_follow_up_date: input.followUpDate ?? null,
    p_escalated_to: input.escalatedTo ?? null,
    p_teacher_id: input.teacherId ?? null,
    p_close_enquiry: input.closeEnquiry,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };

  const row = data as unknown as {
    ticket_id: number;
    status: string;
    existing_open_ticket: number | null;
    closed_enquiry: boolean;
  } | null;
  if (!row?.ticket_id) return { error: "The support ticket was not created." };

  return {
    error: null,
    raised: {
      ticketId: row.ticket_id,
      status: row.status,
      existingOpenTicket: row.existing_open_ticket ?? null,
      closedEnquiry: Boolean(row.closed_enquiry),
    },
  };
}

/**
 * The won purchase enquiry a ticket should be filed against.
 *
 * §62.2 links a ticket raised from a lead to the enquiry the student actually
 * bought through, not to the open lead the counsellor happened to be looking at
 * — the complaint is about the purchase. Newest won enquiry, or null when the
 * student has none, which is a real case: somebody can ring about an order
 * Calman never recorded as won.
 */
export async function wonEnquiryFor(
  base: SupabaseClient<Database>,
  studentId: string,
): Promise<{ id: number; orderId: string | null; teacherId: string | null } | null> {
  const { data } = await base
    .from("enquiries")
    .select("id, order_id, teacher_id")
    .eq("student_id", studentId)
    .eq("status", "won")
    .order("closed_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data
    ? { id: data.id, orderId: data.order_id, teacherId: data.teacher_id }
    : null;
}
