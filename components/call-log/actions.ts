"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { istToday } from "@/lib/format";
import {
  outcomesFor,
  type CallOutcome,
  type EnquiryStatus,
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
  /**
   * §25. The counsellor flipped "This is an after-sale call" in the panel: the
   * enquiry becomes a ticket before the call is written, and the call is
   * logged against whichever enquiry the conversion decides on.
   */
  convertToAfterSale?: boolean;
};

export type LogCallResult = {
  error: string | null;
  ok?: string;
  /**
   * Set when §25 moved the call onto a new after-sale enquiry, because the
   * original had sales calls on it worth keeping.
   */
  convertedTo?: number;
  /**
   * Set when §23.5 moved the call onto a new enquiry: an offer call to a lost
   * lead with a live outcome opens one for the student. The screen needs to
   * know so it can say so rather than silently showing a different row.
   */
  reopenedAs?: number;
};

export type PanelCall = {
  id: number;
  enquiryId: number;
  /** False for a call on one of the student's other enquiries. */
  sameEnquiry: boolean;
  calledAt: string;
  callDate: string;
  outcome: CallOutcome;
  discussion: string | null;
  nextFollowUpDate: string | null;
  callerName: string | null;
};

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
  /** The at-a-glance block (§21.2) needs the same facts the history shows. */
  status: EnquiryStatus;
  sourceNames: string[];
  nextFollowUpDate: string | null;
  reEnquiredAt: string | null;
  createdAt: string;
  /**
   * Every call on this student, this enquiry and their others (§21.2). A
   * re-enquired lead is a new enquiry on an old number, so the calls that
   * matter to the counsellor are mostly not on the row in front of them.
   */
  timeline: PanelCall[];
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
       follow_up_slots_used, status, next_follow_up_date, re_enquired_at, created_at,
       student_id,
       enquiry_sources ( occurred_at, source:sources ( name ) ),
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

  // Every call this student has ever had, across all of their enquiries. The
  // filter is on the embedded enquiry, so the database returns this student's
  // calls and nothing else — taking the most recent N globally and filtering
  // here would quietly lose their history on a busy day.
  //
  // One query through the student, not through this enquiry: a re-enquired
  // number carries its history on the rows that came before, and a counsellor
  // about to speak to somebody needs to know what was last said to *them*, not
  // what was last said about this particular enquiry id.
  const { data: callRows } = await supabase
    .from("calls")
    .select(
      `id, enquiry_id, called_at, call_date, outcome, discussion, next_follow_up_date,
       caller:profiles!calls_called_by_fkey ( full_name ),
       enquiry:enquiries!calls_enquiry_id_fkey!inner ( student_id )`,
    )
    .eq("enquiry.student_id", data.student_id)
    .order("called_at", { ascending: false })
    .limit(200);

  const timeline: PanelCall[] = ((callRows ?? []) as unknown as {
    id: number;
    enquiry_id: number;
    called_at: string;
    call_date: string;
    outcome: CallOutcome;
    discussion: string | null;
    next_follow_up_date: string | null;
    caller: { full_name: string | null } | null;
  }[]).map((c) => ({
    id: c.id,
    enquiryId: c.enquiry_id,
    sameEnquiry: c.enquiry_id === data.id,
    calledAt: c.called_at,
    callDate: c.call_date,
    outcome: c.outcome,
    discussion: c.discussion,
    nextFollowUpDate: c.next_follow_up_date,
    callerName: c.caller?.full_name ?? null,
  }));

  const sourceNames = [
    ...new Set(
      [...((data.enquiry_sources ?? []) as { occurred_at: string; source: { name: string } | null }[])]
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .map((e) => e.source?.name)
        .filter((n): n is string => Boolean(n)),
    ),
  ];

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
      status: data.status as EnquiryStatus,
      sourceNames,
      nextFollowUpDate: data.next_follow_up_date,
      reEnquiredAt: data.re_enquired_at,
      createdAt: data.created_at,
      timeline,
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

  // §25. Done first, because everything below asks questions of the enquiry's
  // type and the conversion is what changes the answer. It also decides which
  // enquiry the call lands on: the same one when there was nothing to
  // preserve, a new one when there were sales calls worth keeping.
  let targetEnquiryId = input.enquiryId;
  let convertedTo: number | undefined;
  let type = enquiry.type as EnquiryType;

  if (input.convertToAfterSale && type === "purchase") {
    const { data: converted, error: convertError } = await supabase.rpc(
      "convert_to_after_sale",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { p_enquiry_id: input.enquiryId } as any,
    );
    if (convertError) {
      return { error: `Could not convert to an after-sale enquiry: ${convertError.message}` };
    }
    type = "after_sale";
    const newId = Number(converted);
    if (newId !== input.enquiryId) {
      targetEnquiryId = newId;
      convertedTo = newId;
    }
  }

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
      .eq("enquiry_id", targetEnquiryId);
    if (countError) return { error: countError.message };
    if ((count ?? 0) === 0 && input.newItems.length === 0) {
      return {
        error:
          "Add the teacher that lost this student — a competitor loss with no teacher against it tells the teacher-wise report nothing.",
      };
    }
  }

  const orderId = input.orderId?.trim() || null;

  // ---- 0. Is this an offer call, and what does that change? ----------------
  //
  // Derived here rather than taken from the client: whether a call is exempt
  // from the three-slot rule is not something a form post gets to assert. The
  // question is the same one app.calls_before_write() asks — is there an offer
  // assignment for this lead today — and it is asked here as well because the
  // answer decides, before anything is written, which enquiry the call lands
  // on at all.
  const today = istToday();
  const { data: todaysAssignment } = await supabase
    .from("assignments")
    .select("bucket")
    .eq("enquiry_id", input.enquiryId)
    .eq("date", today)
    .maybeSingle();

  const isOfferCall = todaysAssignment?.bucket === "offer";

  // §23.5. A lost enquiry is a finished story and §4.9 keeps it that way, so a
  // live outcome cannot be written onto it — it would quietly reopen the row
  // and lose the record that the lead was ever lost. The student gets a new
  // enquiry instead (§4.8), and the call goes there. closed and competitor are
  // not live outcomes: they confirm the loss, so they stay on the old row.
  let reopenedAs: number | undefined;

  if (
    type === "purchase" &&
    isOfferCall &&
    enquiry.status === "lost" &&
    outcome !== "closed" &&
    outcome !== "competitor"
  ) {
    // Which offer to credit it to: the one closing soonest, which is the one
    // the counsellor was ringing about.
    const { data: match } = await supabase
      .from("offer_matches")
      .select("offer_id, end_date")
      .eq("enquiry_id", input.enquiryId)
      // The same line test the offer bucket uses (migration 0069): anything
      // they have not bought. A lead that went to a competitor has no open
      // lines left and a dropped one has none but closed, and those are
      // exactly the leads §23.5 is about.
      .neq("item_status", "won")
      .lte("window_from", today)
      .gte("end_date", today)
      .order("end_date")
      .limit(1)
      .maybeSingle();

    if (!match?.offer_id) {
      return {
        error:
          "This lead is lost and no offer covers it today, so there is nothing to reopen it under. Refresh the day and try again.",
      };
    }

    const { data: newId, error: reopenError } = await supabase.rpc("reopen_via_offer", {
      p_enquiry_id: input.enquiryId,
      p_offer_id: match.offer_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (reopenError) {
      return { error: `Could not reopen the lead: ${reopenError.message}` };
    }
    targetEnquiryId = Number(newId);
    reopenedAs = targetEnquiryId;

    // The panel showed the dead enquiry's interest lines, so every decision in
    // front of the counsellor points at an id that now belongs to the wrong
    // enquiry. reopen_via_offer copied the lines the offer targets, so each
    // decision is re-pointed at its copy by what the line *is* — the same
    // teacher, course, subject and content. A decision whose line the offer
    // does not target has no copy and is dropped: it was never part of what
    // this call was about.
    const shape = (i: {
      teacher_id: string;
      course_id: string;
      subject_id: string | null;
      content_id: string | null;
    }) => [i.teacher_id, i.course_id, i.subject_id ?? "", i.content_id ?? ""].join("|");

    const [{ data: oldItems }, { data: newItems }] = await Promise.all([
      supabase
        .from("enquiry_items")
        .select("id, teacher_id, course_id, subject_id, content_id")
        .eq("enquiry_id", input.enquiryId),
      supabase
        .from("enquiry_items")
        .select("id, teacher_id, course_id, subject_id, content_id")
        .eq("enquiry_id", targetEnquiryId),
    ]);

    const copyOf = new Map<string, string>();
    const byShape = new Map((newItems ?? []).map((i) => [shape(i), i.id]));
    for (const old of oldItems ?? []) {
      const copy = byShape.get(shape(old));
      if (copy) copyOf.set(old.id, copy);
    }

    input = {
      ...input,
      existingItems: input.existingItems.flatMap((d) => {
        const copy = copyOf.get(d.id);
        return copy ? [{ ...d, id: copy }] : [];
      }),
    };

    if (outcome === "purchased" && !input.existingItems.some((d) => d.won)
        && !input.newItems.some((i) => i.won)) {
      return {
        error:
          "None of the ticked lines are part of this offer, so there is nothing to record the purchase against. Add the line that was bought under Edit interests.",
      };
    }
  }

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
        enquiry_id: targetEnquiryId,
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
    type === "purchase" &&
    (nextImportance !== (enquiry.importance ?? null) ||
      nextLead !== (enquiry.lead_verification ?? null));

  if (gradingChanged) {
    const { error } = await supabase
      .from("enquiries")
      .update({ importance: nextImportance, lead_verification: nextLead })
      .eq("id", targetEnquiryId);
    // Not fatal: the call is the record of what happened and must still be
    // written. A refused grading is a permissions problem worth a server log.
    if (error) console.error("Could not save the grading:", error.message);
  }

  // ---- 3. The call, last ---------------------------------------------------
  // call_date and enquiry_type are set by app.calls_before_write();
  // next_follow_up_date is snapped to a working day by the same trigger.
  const { data: savedCall, error: callError } = await supabase.from("calls").insert({
    enquiry_id: targetEnquiryId,
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
    // §23.2. Asserted rather than left to app.calls_before_write() to derive,
    // because a reopened lead's new enquiry has no assignment yet — the claim
    // below is what creates it, a moment after this insert.
    is_offer_call: isOfferCall,
  })
    // called_at is a column default, so the only way to know the instant the
    // database recorded is to read it back. The claim below is stamped with it.
    .select("called_at")
    .single();

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
  //
  // assigned_at is the call's own called_at, not now(). The assignment exists
  // *because* of this call, so recording it as having happened a few
  // milliseconds afterwards is not a rounding detail — My Day asks whether a
  // call came at or after assigned_at, and with now() the answer for the call
  // that caused it was no. The lead the counsellor had just finished came back
  // as still to do.
  if (type === "purchase") {
    const { error: claimError } = await supabase.from("assignments").insert({
      enquiry_id: targetEnquiryId,
      date: istToday(),
      counsellor_id: viewer.userId!,
      assigned_at: savedCall?.called_at ?? new Date().toISOString(),
      // The same bucket taking a lead from the New Calls pool uses: this is
      // the counsellor picking up work for themselves, not a manager handing
      // it out, and My Day's tabs read the bucket to tell those apart. An
      // offer call keeps its own bucket, so the reopened lead lands in Offer
      // Calls beside the one it came from and §5.8 counts it under Offers.
      bucket: isOfferCall ? "offer" : "fresh",
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

  if (convertedTo) {
    return {
      error: null,
      ok: `Call logged as an after-sale ticket. Enquiry #${input.enquiryId} had sales calls on it, so it was closed as converted and this call opened ticket #${convertedTo}.`,
      convertedTo,
    };
  }

  return {
    error: null,
    ok: reopenedAs
      ? `Call logged. This lead was lost, so the call opened enquiry #${reopenedAs} for the student — the old one stays lost in their history.`
      : "Call logged.",
    reopenedAs,
  };
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
