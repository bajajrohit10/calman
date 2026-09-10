"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import {
  outcomesFor,
  type CallOutcome,
  type EnquiryType,
  type IssueCategory,
} from "@/lib/enquiry-labels";
import { createClient } from "@/lib/supabase/server";

export type ItemDecision = {
  id: string;
  /** Ticked in the Purchased checklist → the item was bought. */
  won: boolean;
  /** Only meaningful when `won`. Optional per §10 decision on amounts. */
  amount: string | null;
  /** Untied item the counsellor chose to stop following rather than keep open. */
  close: boolean;
};

export type NewItem = {
  teacherId: string;
  courseId: string;
  subjectId: string | null;
  contentId: string | null;
  won: boolean;
  amount: string | null;
};

export type LogCallInput = {
  enquiryId: number;
  outcome: CallOutcome | "";
  discussion: string;
  nextFollowUpDate: string | null;
  whatsappSent: boolean;
  issueCategory: IssueCategory | "" | null;
  orderId: string | null;
  existingItems: ItemDecision[];
  newItems: NewItem[];
};

export type LogCallResult = { error: string | null; ok?: string };

export type PanelPayload = {
  id: number;
  type: EnquiryType;
  studentName: string | null;
  mobile: string;
  term: string | null;
  items: {
    id: string;
    status: string;
    teacher: string | null;
    course: string | null;
    subject: string | null;
    content: string | null;
  }[];
};

/**
 * Everything the call panel needs for one enquiry, fetched when a row is
 * opened rather than preloaded for the whole day — a list of fifty rows would
 * otherwise carry fifty sets of items nobody looks at.
 */
export async function loadPanelEnquiry(
  enquiryId: number,
): Promise<{ error: string | null; enquiry?: PanelPayload }> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enquiries")
    .select(
      `id, type,
       term:terms ( name ),
       students ( name, mobile ),
       enquiry_items (
         id, status,
         teacher:teachers ( name ),
         course:courses ( name ),
         subject:subjects ( name ),
         content:contents ( name )
       )`,
    )
    .eq("id", enquiryId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "That enquiry no longer exists." };

  const student = data.students as { name: string | null; mobile: string } | null;

  return {
    error: null,
    enquiry: {
      id: data.id,
      type: data.type as EnquiryType,
      studentName: student?.name ?? null,
      mobile: student?.mobile ?? "",
      term: (data.term as { name: string } | null)?.name ?? null,
      items: (data.enquiry_items ?? []).map((i) => ({
        id: i.id,
        status: i.status,
        teacher: (i.teacher as { name: string } | null)?.name ?? null,
        course: (i.course as { name: string } | null)?.name ?? null,
        subject: (i.subject as { name: string } | null)?.name ?? null,
        content: (i.content as { name: string } | null)?.name ?? null,
      })),
    },
  };
}

function parseAmount(raw: string | null): number | null | "invalid" {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

/**
 * Log one call (§5.3).
 *
 * The division of labour with the database is the whole point of this action:
 * it writes `calls` and `enquiry_items` and nothing else. Enquiry status,
 * lost/close reason, the follow-up slot count and the stored follow-up date
 * are all derived by app.recompute_enquiry() from the call history, and
 * `next_follow_up_date` is snapped to a working day by the before-write
 * trigger. Duplicating any of that here would give two sources of truth that
 * disagree the first time a call is corrected.
 *
 * Items are written *before* the call so the recompute fired by the call
 * insert already sees their final state. Both orders converge — the recompute
 * is idempotent — but this way a purchase settles in one pass instead of
 * flickering through `open` and leaving that in the audit log.
 */
export async function logCall(input: LogCallInput): Promise<LogCallResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const supabase = await createClient();

  const { data: enquiry, error: enquiryError } = await supabase
    .from("enquiries")
    .select("id, type, status, student_id, students ( mobile )")
    .eq("id", input.enquiryId)
    .maybeSingle();

  if (enquiryError) return { error: enquiryError.message };
  if (!enquiry) return { error: "That enquiry no longer exists." };

  const type = enquiry.type as EnquiryType;
  const outcome = input.outcome;

  if (!outcome) return { error: "Choose an outcome." };
  if (!outcomesFor(type).includes(outcome)) {
    return { error: "That outcome does not apply to this kind of enquiry." };
  }

  // §4: only the outcomes that carry the enquiry forward take a date, and a
  // `follow_up` without one would leave the lead with no next action.
  if (outcome === "follow_up" && !input.nextFollowUpDate) {
    return { error: "A follow-up needs a next follow-up date." };
  }

  if (type === "after_sale" && !input.issueCategory) {
    return { error: "An after-sale call needs an issue category." };
  }

  const ticked =
    input.existingItems.filter((i) => i.won).length +
    input.newItems.filter((i) => i.won).length;

  if (outcome === "purchased" && ticked === 0) {
    return {
      error:
        "Tick at least one item that was bought — a won enquiry with no teacher against it is invisible to the teacher-wise reports.",
    };
  }

  if (outcome === "purchased" && !input.orderId?.trim()) {
    return { error: "A purchase needs an order ID." };
  }

  const orderId = input.orderId?.trim() || null;

  // ---- 1. New interest lines from "Edit interests" -------------------------
  if (input.newItems.length) {
    const rows = [];
    for (const item of input.newItems) {
      if (!item.teacherId || !item.courseId) {
        return { error: "Every interest line needs at least a teacher and a course." };
      }
      const amount = parseAmount(item.amount);
      if (amount === "invalid") return { error: "An amount must be a number." };

      rows.push({
        enquiry_id: input.enquiryId,
        teacher_id: item.teacherId,
        course_id: item.courseId,
        subject_id: item.subjectId || null,
        content_id: item.contentId || null,
        created_by: viewer.userId,
        // Written at its final status rather than inserted open and updated:
        // one write, and the recompute below sees the settled value.
        status: item.won ? ("won" as const) : ("open" as const),
        order_id: item.won ? orderId : null,
        amount: item.won ? amount : null,
      });
    }

    const { error } = await supabase.from("enquiry_items").insert(rows);
    if (error) return { error: `Could not save the interests: ${error.message}` };
  }

  // ---- 2. Existing items ---------------------------------------------------
  // §5.3 "outcome applies to all items automatically": a competitor or
  // wrong-number call settles every still-open line, so the teacher-wise
  // analytics in §7 see the loss. follow_up and call_back leave items alone.
  const sweep: Record<string, "competitor" | "closed"> = {
    competitor: "competitor",
    closed: "closed",
  };

  for (const decision of input.existingItems) {
    if (outcome === "purchased") {
      if (decision.won) {
        const amount = parseAmount(decision.amount);
        if (amount === "invalid") return { error: "An amount must be a number." };
        const { error } = await supabase
          .from("enquiry_items")
          .update({ status: "won", order_id: orderId, amount })
          .eq("id", decision.id);
        if (error) return { error: error.message };
      } else if (decision.close) {
        const { error } = await supabase
          .from("enquiry_items")
          .update({ status: "closed" })
          .eq("id", decision.id);
        if (error) return { error: error.message };
      }
      // Unticked and not closed = "keep following": left open on purpose.
      continue;
    }

    const swept = sweep[outcome];
    if (swept) {
      const { error } = await supabase
        .from("enquiry_items")
        .update({ status: swept })
        .eq("id", decision.id)
        .eq("status", "open");
      if (error) return { error: error.message };
    }
  }

  // ---- 3. The call, last ---------------------------------------------------
  // call_date and enquiry_type are set by app.calls_before_write();
  // next_follow_up_date is snapped to a working day by the same trigger.
  const { error: callError } = await supabase.from("calls").insert({
    enquiry_id: input.enquiryId,
    // Denormalised from the parent and re-asserted by the before-write trigger;
    // the composite FK (enquiry_id, enquiry_type) means a wrong value here is
    // rejected outright rather than silently stored.
    enquiry_type: type,
    called_by: viewer.userId!,
    outcome,
    discussion: input.discussion.trim() || null,
    next_follow_up_date: input.nextFollowUpDate || null,
    whatsapp_sent: input.whatsappSent,
    issue_category: type === "after_sale" ? (input.issueCategory as IssueCategory) : null,
    order_id: orderId,
  });

  if (callError) return { error: `Could not log the call: ${callError.message}` };

  const mobile = (enquiry.students as { mobile: string } | null)?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/quick-add");

  return { error: null, ok: "Call logged." };
}
