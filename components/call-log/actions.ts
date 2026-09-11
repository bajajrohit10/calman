"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { istToday } from "@/lib/format";
import {
  outcomesFor,
  type CallOutcome,
  type EnquiryType,
  type Importance,
  type IssueCategory,
  type LeadVerification,
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
  issueCategory: IssueCategory | "" | null;
  /**
   * Graded on the call (Brief 16). Written to the enquiry only when it
   * actually changes, so an unchanged call adds nothing to the audit log —
   * which matters because §5.8 counts a re-grade to A there as a price list
   * issued, and a no-op save must not count as one.
   */
  importance: Importance | "" | null;
  leadVerification: LeadVerification | "" | null;
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
  productText: string | null;
  slotsUsed: number;
  /** Current values for the "Edit enquiry details" control. */
  termId: string | null;
  sourceId: string | null;
  importance: Importance | null;
  leadVerification: LeadVerification | null;
  /**
   * What the follow-up field opens on for the outcomes that take a date
   * (§20.2). Decided by the database so it agrees with the trigger that will
   * snap the saved value — Sundays and the holidays table, one implementation.
   */
  defaultFollowUpDate: string | null;
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
      `id, type, product_text, term_id, source_id, importance, lead_verification,
       follow_up_slots_used,
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

  const { data: nextDay } = await supabase.rpc("next_working_day", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return {
    error: null,
    enquiry: {
      id: data.id,
      type: data.type as EnquiryType,
      studentName: student?.name ?? null,
      mobile: student?.mobile ?? "",
      term: (data.term as { name: string } | null)?.name ?? null,
      productText: data.product_text,
      slotsUsed: data.follow_up_slots_used ?? 0,
      termId: data.term_id,
      sourceId: data.source_id,
      importance: data.importance as Importance | null,
      leadVerification: data.lead_verification as LeadVerification | null,
      defaultFollowUpDate: (nextDay as string | null) ?? null,
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
    .select(
      "id, type, status, student_id, archived_at, importance, lead_verification, students ( mobile )",
    )
    .eq("id", input.enquiryId)
    .maybeSingle();

  if (enquiryError) return { error: enquiryError.message };
  if (!enquiry) return { error: "That enquiry no longer exists." };

  // §9: an archived enquiry has been exported, or is being exported right now.
  // Every screen already hides it, but a tab left open from before the archive
  // is still a way in, and a call landing after the workbook was built would be
  // a call that exists nowhere in the archive.
  if (enquiry.archived_at) {
    return {
      error:
        "That enquiry has been archived. Unarchive it from the student's history before logging a call.",
    };
  }

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

  // A competitor loss is only worth recording if it says who we lost to.
  // Enforced here and not only in the panel, because the panel is one caller
  // of this and the report is built on what lands in the table.
  if (outcome === "competitor") {
    const { count, error: countError } = await supabase
      .from("enquiry_items")
      .select("*", { count: "exact", head: true })
      .eq("enquiry_id", input.enquiryId);
    if (countError) return { error: countError.message };
    if ((count ?? 0) === 0 && input.newItems.length === 0) {
      return {
        error:
          "Add the teacher that lost this student — a competitor loss with no teacher against it tells the teacher-wise report nothing.",
      };
    }
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
        // §5.8 credits the day's revenue from this, so it is written with the
        // sale rather than inferred from the call afterwards.
        won_at: item.won ? new Date().toISOString() : null,
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
          .update({
            status: "won",
            order_id: orderId,
            amount,
            won_at: new Date().toISOString(),
          })
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

  // ---- 2b. The grading made on this call -----------------------------------
  // Before the call rather than after, for the same reason the items are: the
  // recompute the call fires then sees settled values, and the enquiry is
  // never briefly inconsistent with the call that changed it.
  //
  // Only when something actually changed. The audit trigger is what §5.8 reads
  // for "PLI issued" — an enquiries row whose new importance is A when the old
  // one was not — so writing the same value back on every call would be
  // harmless for the data and wrong for the metric.
  const nextImportance = (input.importance || null) as Importance | null;
  const nextLead = (input.leadVerification || null) as LeadVerification | null;
  const gradingChanged =
    nextImportance !== (enquiry.importance ?? null) ||
    nextLead !== (enquiry.lead_verification ?? null);

  if (gradingChanged) {
    const { error } = await supabase
      .from("enquiries")
      .update({ importance: nextImportance, lead_verification: nextLead })
      .eq("id", input.enquiryId);
    // Not fatal: the call is the record of what happened and must still be
    // written. A refused grading is a permissions problem worth a server log.
    if (error) console.error("Could not save the grading:", error.message);
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
    // whatsapp_sent is legacy: sends are recorded in whatsapp_sends (§5.10),
    // outside the calls table so the slot rule never counts one.
    issue_category: type === "after_sale" ? (input.issueCategory as IssueCategory) : null,
    order_id: orderId,
  });

  if (callError) return { error: `Could not log the call: ${callError.message}` };

  // ---- 4. Claim the day, if nobody else has --------------------------------
  // A call is work done today, and My Day is "what I worked today" — so an
  // enquiry nobody was assigned becomes the caller's. Without this, a lead
  // picked up in Quick Add would be called, closed and never appear on the
  // caller's day or in the day's counts, and a hand-called lead would sit in
  // the New Calls pool tomorrow looking untouched.
  //
  // The insert is the check: (enquiry_id, date) is unique, so an enquiry the
  // Assignment Desk already handed to someone stays theirs and this quietly
  // loses the race. That is the point — this claims unowned work only, it
  // never takes work off a colleague.
  //
  // Purchase only. After-sale work is worked in Tickets, which is its own tab
  // on My Day; an assignment would have it counted in two places at once.
  if (type === "purchase") {
    const { error: claimError } = await supabase.from("assignments").insert({
      enquiry_id: input.enquiryId,
      date: istToday(),
      counsellor_id: viewer.userId!,
      // The same bucket taking a lead from the New Calls pool uses: this is
      // the counsellor picking up work for themselves, not a manager handing
      // it out, and My Day's tabs read the bucket to tell those apart.
      bucket: "fresh",
      assigned_by: viewer.userId!,
    });
    // 23505 is the expected outcome whenever the enquiry was already on
    // somebody's day. Anything else is worth a server log, but never worth
    // failing a call that is already written.
    if (claimError && claimError.code !== "23505") {
      console.error("Could not claim the enquiry for today:", claimError.message);
    }
  }

  const mobile = (enquiry.students as { mobile: string } | null)?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/quick-add");
  revalidatePath("/my-day");
  revalidatePath("/new-calls");

  return { error: null, ok: "Call logged." };
}


/**
 * Correct an enquiry's grading (§5.3), and the student's name with it.
 *
 * These are the fields a counsellor learns on the call: which attempt they are
 * sitting, where they came from, whether they have a competitor quote, and how
 * serious they are. Re-grading to importance A is what §5.8 counts as a price
 * list issued, so this is also the only path that metric has.
 *
 * RLS decides what may be written — the column grant on enquiries limits it to
 * these four, and students to `name` — so this action deliberately does not
 * re-implement that check. It writes as the caller and lets the database
 * refuse anything else.
 */
export async function updateEnquiryDetails(input: {
  enquiryId: number;
  importance: Importance | "" | null;
  termId: string | null;
  sourceId: string | null;
  leadVerification: LeadVerification | "" | null;
  studentName: string | null;
}): Promise<{ error: string | null; ok?: string }> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const supabase = await createClient();

  const { data: enquiry, error: findError } = await supabase
    .from("enquiries")
    .select("id, student_id, students ( mobile )")
    .eq("id", input.enquiryId)
    .maybeSingle();

  if (findError) return { error: findError.message };
  if (!enquiry) return { error: "That enquiry no longer exists." };

  const { error } = await supabase
    .from("enquiries")
    .update({
      importance: input.importance || null,
      term_id: input.termId || null,
      source_id: input.sourceId || null,
      lead_verification: input.leadVerification || null,
    })
    .eq("id", input.enquiryId);

  if (error) return { error: `Could not save the details: ${error.message}` };

  const name = input.studentName?.trim() || null;
  const { error: nameError } = await supabase
    .from("students")
    .update({ name })
    .eq("id", enquiry.student_id);

  if (nameError) return { error: `Could not save the name: ${nameError.message}` };

  const mobile = (enquiry.students as { mobile: string } | null)?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/enquiries");

  return { error: null, ok: "Details saved." };
}

/**
 * Add interest lines without logging a call (§5.2).
 *
 * The student history page can now record a teacher the moment it is learned,
 * rather than making the counsellor open a call panel to do it. Items added
 * this way are always `open`: a purchase is settled by the call that records
 * it, and nothing here may mark one won.
 */
export async function addEnquiryItems(input: {
  enquiryId: number;
  lines: {
    teacherId: string;
    courseId: string;
    subjectId: string | null;
    contentId: string | null;
  }[];
}): Promise<LogCallResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const lines = input.lines.filter((l) => l.teacherId && l.courseId);
  if (!lines.length) {
    return { error: "Every interest line needs at least a teacher and a course." };
  }

  const supabase = await createClient();

  const { data: enquiry, error: findError } = await supabase
    .from("enquiries")
    .select("id, students ( mobile )")
    .eq("id", input.enquiryId)
    .maybeSingle();

  if (findError) return { error: findError.message };
  if (!enquiry) return { error: "That enquiry no longer exists." };

  const { error } = await supabase.from("enquiry_items").insert(
    lines.map((l) => ({
      enquiry_id: input.enquiryId,
      teacher_id: l.teacherId,
      course_id: l.courseId,
      subject_id: l.subjectId || null,
      content_id: l.contentId || null,
      created_by: viewer.userId,
      status: "open" as const,
    })),
  );

  if (error) return { error: `Could not save the interests: ${error.message}` };

  const mobile = (enquiry.students as { mobile: string } | null)?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/enquiries");

  return {
    error: null,
    ok: `Added ${lines.length} interest${lines.length === 1 ? "" : "s"}.`,
  };
}
