"use server";

import { revalidatePath } from "next/cache";

import { clearAutoFlag } from "@/lib/auto-interests";
import { dropDuplicateLines, rowShape } from "@/lib/interest-shape";

import { isAdmin, requireUser } from "@/lib/auth";
import { istToday } from "@/lib/format";
import {
  AFTER_SALE_OUTCOMES,
  outcomesFor,
  type CallOutcome,
  type EnquiryStatus,
  type EnquiryType,
  type Importance,
  type IssueCategory,
  type LeadVerification,
} from "@/lib/enquiry-labels";
import { createClient } from "@/lib/supabase/server";
import {
  raiseTicketFromCounselling,
  wonEnquiryFor,
} from "@/lib/support/from-counselling";
import { type WorkingDayInfo } from "@/lib/working-days-shape";

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
  /**
   * §77.3. Who the sale belongs to, when that is not the caller. Null means the
   * caller, and the reports read coalesce(credited_to, called_by) — so the common
   * case stores nothing and the default can never drift from the fallback.
   */
  creditedTo?: string | null;
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
  /** §38.2: the mirror — this ticket call is really a sales conversation. */
  convertToPurchase?: boolean;
  /**
   * §44.1. What the ticket itself carries. Written on the after-sale enquiry
   * rather than on the call, because an order id that lives on whichever call
   * happened to mention it is an order id a fresh ticket does not have.
   */
  ticketOrderId?: string | null;
  ticketProduct?: string | null;
  ticketTeacherId?: string | null;
  /** §44.2: set with the escalated outcome, kept afterwards. */
  escalatedTo?: string | null;
  /**
   * §26.2. The first-call form has the student's name and the term on it,
   * because on a first call there is nothing else to look at and hiding them
   * behind a drawer is how leads reach the second call with neither. Both are
   * only sent by that form, and only written when they actually change.
   */
  studentName?: string | null;
  termId?: string | null;
  sourceId?: string | null;
  /**
   * §49.2. The product text, from the first-call form. Written through the
   * same security-definer door the ticket fields use, because the column grant
   * on enquiries does not cover it.
   */
  productText?: string | null;
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
  /**
   * §62.2. Set when the save raised a support ticket instead of — or as well as
   * — carrying the counselling enquiry forward. The screen redirects to it.
   */
  supportTicketId?: number;
  /**
   * An open support ticket the number already had. Named in the toast, never
   * merged into: §62.2 is explicit that a counselling call raises its own
   * ticket, and the merge prompt is Brief 63's.
   */
  existingSupportTicketId?: number;
  /**
   * §69.2. The purchase lead closed as superseded because the ticket was raised
   * from a lead nobody had called yet. Named so the ticket page can say a row
   * left New Calls, rather than letting it vanish without explanation.
   */
  /** §78. The lead the hand-off closed, so the ticket page can say which. */
  closedLeadId?: number;
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
  /** §77.3: who the sale belongs to, when that is not the caller. */
  creditedToId: string | null;
  creditedToName: string | null;
  /** §29.4: who logged it, so the row knows whether you may correct it. */
  calledBy: string;
};

export type PanelPayload = {
  /** §7.1. What was written before anyone rang; pre-fills the Note field. */
  preCallNote: string | null;
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
  /**
   * §54.2. The working-day arithmetic for the follow-up chips, and the closed
   * dates near enough to matter, so the manual box can say why a date is shut.
   */
  calendar: WorkingDayInfo | null;
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
  /** §29.4: who is looking, and whether they may correct anybody's call. */
  viewerId: string | null;
  viewerIsAdmin: boolean;
  /**
   * The issue this ticket is already about (§26.1).
   *
   * logCall refuses an after-sale call without a category, and the field used
   * to open empty on every call — so a counsellor opening an escalated ticket
   * that already had one, typing a note and choosing Resolved was refused, and
   * the ticket would not close. The category belongs to the ticket, not to the
   * call, so it is carried in and pre-chosen.
   */
  issueCategory: IssueCategory | null;
  /** §44.1/§44.2: the ticket's own fields, so the panel opens holding them. */
  orderId: string | null;
  teacherId: string | null;
  escalatedTo: string | null;
  items: {
    id: string;
    status: string;
    /** §49.2: parser-filled and unconfirmed. */
    isAuto: boolean;
    teacherId: string | null;
    courseId: string | null;
    subjectId: string | null;
    contentId: string | null;
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
  const supabase = await createClient();

  /**
   * §46.1. Three sequential crossings to Mumbai is most of what a counsellor
   * waits for when a row opens, and two of them wait on nothing.
   *
   * The working-day default reads nothing this function reads. The enquiry
   * read is authorised by RLS, not by the order of these awaits — the policy
   * decides what comes back whoever asks — so blocking it on the viewer's own
   * profile row buys a round trip's delay and no safety. The viewer is still
   * awaited before anything is *returned*, so an inactive account gets the
   * same refusal it always did.
   */
  /**
   * §54.2, anchored by §79. The picker's chips, the default date, and which of
   * the next few weeks' dates are closed — computed where the arithmetic lives.
   *
   * "+3 days" used to be Date + 3, so a Thursday offered a Sunday, and the
   * trigger on calls then silently stored the Monday. The chip and the record
   * disagreed about what the counsellor had just promised the student.
   *
   * §79 folded the separate next_working_day call into this one. The default is
   * the first offset — one answer rather than two that could disagree — and the
   * anchor is the later of today and the day this lead was already due, which is
   * why the enquiry id goes in. It still runs beside the enquiry read rather than
   * after it: the id is this function's own argument, so nothing has to come back
   * before the question can be asked.
   */
  const calendarPromise = supabase.rpc("follow_up_calendar", {
    p_enquiry_id: enquiryId,
    p_offsets: [1, 3, 7],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const viewerPromise = requireUser();

  const { data, error } = await supabase
    .from("enquiries")
    .select(
      `id, type, product_text, pre_call_note, term_id, source_id, importance, lead_verification,
       follow_up_slots_used, status, next_follow_up_date, re_enquired_at, created_at,
       student_id, order_id, teacher_id, escalated_to,
       enquiry_sources ( occurred_at, source:sources ( name ) ),
       term:terms ( name ),
       students ( name, mobile ),
       enquiry_items (
         id, status, is_auto, teacher_id, course_id, subject_id, content_id,
         teacher:teachers ( name ),
         course:courses ( name ),
         subject:subjects ( name ),
         content:contents ( name )
       )`,
    )
    .eq("id", enquiryId)
    .maybeSingle();

  const viewer = await viewerPromise;

  if (error) return { error: error.message };
  if (!data) return { error: "That enquiry no longer exists." };

  const student = data.students as { name: string | null; mobile: string } | null;


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
       issue_category, called_by,
       caller:profiles!calls_called_by_fkey ( full_name ),
       credited:profiles!calls_credited_to_fkey ( full_name ),
       credited_to,
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
    issue_category: IssueCategory | null;
    called_by: string;
    caller: { full_name: string | null } | null;
    credited_to: string | null;
    credited: { full_name: string | null } | null;
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
    creditedToId: c.credited_to ?? null,
    creditedToName: c.credited?.full_name ?? null,
    calledBy: c.called_by,
  }));

  // Both in flight since before the enquiry came back; this is where the
  // answer is finally needed.
  const calendar = await calendarPromise;
  const cal = (calendar.data as unknown as WorkingDayInfo | null) ?? null;

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
      /** §7.1. What was written before anyone rang; pre-fills the Note field. */
      preCallNote: data.pre_call_note as string | null,
      slotsUsed: data.follow_up_slots_used ?? 0,
      termId: data.term_id,
      sourceId: data.source_id,
      importance: data.importance as Importance | null,
      leadVerification: data.lead_verification as LeadVerification | null,
      // §79. The first chip and the default are the same date by construction.
      defaultFollowUpDate: cal?.nextWorkingDay ?? null,
      calendar: cal,
      status: data.status as EnquiryStatus,
      sourceNames,
      nextFollowUpDate: data.next_follow_up_date,
      reEnquiredAt: data.re_enquired_at,
      createdAt: data.created_at,
      timeline,
      viewerId: viewer.userId ?? null,
      viewerIsAdmin: isAdmin(viewer.profile?.role ?? "counsellor"),
      // The most recent category recorded on this ticket, which is what the
      // ticket is about until somebody says otherwise.
      orderId: data.order_id,
      teacherId: data.teacher_id,
      escalatedTo: data.escalated_to,
      issueCategory:
        ((callRows ?? []) as unknown as {
          enquiry_id: number;
          issue_category: IssueCategory | null;
        }[]).find((c) => c.enquiry_id === data.id && c.issue_category)
          ?.issue_category ?? null,
      items: (data.enquiry_items ?? []).map((i) => ({
        id: i.id,
        status: i.status,
        isAuto: Boolean(i.is_auto),
        teacherId: i.teacher_id,
        courseId: i.course_id,
        subjectId: i.subject_id,
        contentId: i.content_id,
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
      "id, type, status, student_id, archived_at, importance, lead_verification, term_id, source_id, students ( mobile, name )",
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

  /**
   * §62 addendum. The outcome is checked before anything is written.
   *
   * It used to be validated after the conversion below, so saving an after-sale
   * call with the outcome left blank converted the lead to a ticket — closing
   * the purchase enquiry as superseded and creating a new one — and only then
   * refused. The counsellor saw "Choose an outcome." and had no idea two
   * enquiries had just changed underneath them. Found while reproducing bug 3;
   * ZTEST enquiries 1719/1720 are what it did.
   *
   * Only this check moves up. The rest stay below because they depend on the
   * post-conversion type: whether an issue category is required, and which
   * outcomes are legal, are both answers about what the enquiry has become.
   */
  if (!input.outcome) return { error: "Choose an outcome." };

  // §25. Done first, because everything below asks questions of the enquiry's
  // type and the conversion is what changes the answer. It also decides which
  // enquiry the call lands on: the same one when there was nothing to
  // preserve, a new one when there were sales calls worth keeping.
  let targetEnquiryId = input.enquiryId;
  let convertedTo: number | undefined;
  let type = enquiry.type as EnquiryType;

  /**
   * §62.2, as corrected by §78. "This is an after-sale call" hands the lead over.
   *
   * It used to call convert_to_after_sale, which closed the purchase enquiry as
   * superseded and opened an after-sale one in counselling. Support is where that
   * work lives now, so the save raises a ticket.
   *
   * §62.2 then left the lead exactly as it was, on the reasoning that the student
   * is still a live lead whatever went wrong with their order. That reasoning was
   * about the student and the consequence was about the row: with no counselling
   * call written, the lead sat in New Calls for ever and stayed permanently
   * *pending* on the assignment desk, because "still to do" means "no call since
   * it was handed over" (§76). §69.2 closed the ones Quick Add had created seconds
   * earlier and could not touch the rest.
   *
   * §78, one rule for both: the hand-off is written down as a call — outcome
   * ticket_raised, note naming the ticket — and the lead closes as
   * handed_to_support whatever its history. The student being a live lead is
   * answered by Quick Add opening a fresh enquiry on the number, not by leaving a
   * finished one open.
   *
   * The ticket is therefore filed against the lead it was raised from, which is
   * what makes the closed enquiry's badge link to it. The won enquiry still
   * supplies the order id and the teacher — what the complaint is *about* — but it
   * is no longer the thing the ticket is hung on.
   */
  if (input.convertToAfterSale && type === "purchase") {
    const student = enquiry.student_id as string;
    const won = await wonEnquiryFor(supabase, student);

    /**
     * §65.0. The outcome the counsellor chose, carried across.
     *
     * This door used to send 'noted' whatever was picked, so a counsellor who
     * chose "Working on it" watched their ticket appear in the ticket team's New
     * queue — the bug behind #178. Ticking "this is an after-sale call" switches
     * the form to AFTER_SALE_OUTCOMES, so the choice is already one of the five
     * the mapping understands; it is checked rather than trusted because a
     * purchase outcome arriving here would raise inside the transaction.
     *
     * 'noted' and 'working' both keep the ticket with the counsellor now;
     * Escalated and Pending with institute are still a hand-over to New.
     */
    const chosen = (AFTER_SALE_OUTCOMES as readonly string[]).includes(input.outcome)
      ? (input.outcome as (typeof AFTER_SALE_OUTCOMES)[number])
      : "noted";

    const { error: raiseError, raised } = await raiseTicketFromCounselling(supabase, {
      studentId: student,
      // §78. The lead the panel was opened on: the one that closes, the one the
      // hand-off call is written against, and the one the badge hangs off.
      enquiryId: input.enquiryId,
      orderId: input.ticketOrderId?.trim() || won?.orderId || null,
      discussion: input.discussion,
      issueCategory: input.issueCategory || null,
      outcome: chosen,
      // The date the counsellor set, if they set one; the mapping defaults it to
      // the next working day when they did not.
      followUpDate: input.nextFollowUpDate || null,
      // So an Escalated choice on this door names the person, as it does on the
      // after-sale door below.
      escalatedTo: input.escalatedTo ?? null,
      teacherId: input.ticketTeacherId ?? won?.teacherId ?? null,
      // §78. The two halves of the hand-off, in the ticket's own transaction: one
      // counselling call so the lead is done for today, and the close so it stops
      // being live counselling work.
      closeEnquiry: true,
      writeCall: true,
    });
    if (raiseError) return { error: `Could not raise the support ticket: ${raiseError}` };

    revalidatePath("/support");
    if (enquiry.students) {
      const mobile = (enquiry.students as { mobile: string } | null)?.mobile;
      if (mobile) revalidatePath(`/students/${mobile}`);
    }
    return {
      error: null,
      ok: `Support ticket #${raised!.ticketId} created.`,
      supportTicketId: raised!.ticketId,
      existingSupportTicketId: raised!.existingOpenTicket ?? undefined,
      // §78. Travels to the ticket page in the URL, like the rest of this
      // message: the redirect unmounts the panel before a toast could render.
      closedLeadId: raised!.closedLead ?? undefined,
    };
  }

  // §38.2. The same move from the other side: the ticket stays exactly as it
  // is and the call goes to the student's purchase enquiry — the open one if
  // they have it, a new one if they do not.
  if (input.convertToPurchase && type === "after_sale") {
    const { data: opened, error: openError } = await supabase.rpc(
      "convert_to_purchase",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { p_enquiry_id: input.enquiryId } as any,
    );
    if (openError) {
      return { error: `Could not open a purchase enquiry: ${openError.message}` };
    }
    type = "purchase";
    const newId = Number(opened);
    if (newId !== input.enquiryId) {
      targetEnquiryId = newId;
      convertedTo = newId;
    }
  }

  // Non-null by the check above, before the conversion ran.
  const outcome = input.outcome;

  if (!outcomesFor(type).includes(outcome)) {
    return { error: "That outcome does not apply to this kind of enquiry." };
  }

  // §4: only the outcomes that carry the enquiry forward take a date, and a
  // `follow_up` without one would leave the lead with no next action.
  if (outcome === "follow_up" && !input.nextFollowUpDate) {
    return { error: "A follow-up needs a next follow-up date." };
  }

  /**
   * §72.1. An after-sale query needs an outcome and a note. Nothing else.
   *
   * The issue category, the order id and — when escalating — a named person
   * were each refused here. Every one of them is information Support would like
   * and the counsellor may simply not have: a student rings about a course they
   * cannot open and has no order number to hand, and the choice being offered
   * was between a ticket with a gap in it and no ticket at all. The gap is
   * better. Support asks for the rest on the ticket, and §72.3 nudges once at
   * hand-over instead of blocking.
   *
   * The note stays required, because a ticket with no order, no issue and no
   * word of what was said records nothing at all. `issue_from_counselling(null)`
   * already fills issue_other_work with "Raised from counselling", so the row is
   * never issue-less for the reports.
   */
  if (type === "after_sale" && !input.discussion.trim()) {
    return { error: "Say what the query is." };
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
    // this call was about. The same four columns §47.1 de-dupes on, from the
    // one helper, so "the same line" means one thing across the app.
    const shape = rowShape;

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
    // §47.1. Against what the target lead already holds, and within the batch.
    // A won line is never dropped as a duplicate: it carries the order and the
    // amount, and silently discarding a sale would be the worst possible way
    // to be tidy.
    const { data: present } = await supabase
      .from("enquiry_items")
      .select("teacher_id, course_id, subject_id, content_id")
      .eq("enquiry_id", targetEnquiryId)
      .eq("status", "open");
    const seen = new Set((present ?? []).map(rowShape));
    const incoming = input.newItems.filter(
      (i) => i.won || dropDuplicateLines([i], seen).length > 0,
    );

    const rows = [];
    for (const item of incoming) {
      // §39.2. Anything at all, not a teacher *and* a course. A subject is the
      // exception: it belongs to a course, and the table says so too.
      if (!item.teacherId && !item.courseId && !item.subjectId && !item.contentId) {
        return {
          error:
            "An interest line needs at least one of teacher, course, subject or content.",
        };
      }
      if (item.subjectId && !item.courseId) {
        return { error: "A subject needs its course chosen too." };
      }
      const amount = parseAmount(item.amount);
      if (amount === "invalid") return { error: "An amount must be a number." };

      rows.push({
        enquiry_id: targetEnquiryId,
        teacher_id: item.teacherId || null,
        course_id: item.courseId || null,
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

  // §26.2. The name is the student's, the term is the enquiry's; both only
  // when the first-call form sent them and the value is genuinely different.
  if (input.studentName !== undefined) {
    const next = input.studentName?.trim() || null;
    const current = (enquiry.students as { name?: string | null } | null)?.name ?? null;
    if (next !== current && enquiry.student_id) {
      const { error } = await supabase
        .from("students")
        .update({ name: next })
        .eq("id", enquiry.student_id);
      if (error) console.error("Could not save the name:", error.message);
    }
  }

  if (input.sourceId !== undefined) {
    const next = input.sourceId || null;
    if (next !== ((enquiry as { source_id?: string | null }).source_id ?? null)) {
      const { error } = await supabase
        .from("enquiries")
        .update({ source_id: next })
        .eq("id", targetEnquiryId);
      if (error) console.error("Could not save the source:", error.message);
    }
  }

  if (input.termId !== undefined) {
    const next = input.termId || null;
    if (next !== ((enquiry as { term_id?: string | null }).term_id ?? null)) {
      const { error } = await supabase
        .from("enquiries")
        .update({ term_id: next })
        .eq("id", targetEnquiryId);
      if (error) console.error("Could not save the term:", error.message);
    }
  }

  if (gradingChanged) {
    const { error } = await supabase
      .from("enquiries")
      .update({ importance: nextImportance, lead_verification: nextLead })
      .eq("id", targetEnquiryId);
    // Not fatal: the call is the record of what happened and must still be
    // written. A refused grading is a permissions problem worth a server log.
    if (error) console.error("Could not save the grading:", error.message);
  }

  // §44.1/§44.2. The ticket's own fields, before the call — the call's insert
  // fires the recompute that sets the status, and the escalatee has to be on
  // the row by the time the status change is logged or ticket_events records
  // an escalation to nobody.
  if (type === "after_sale") {
    // Through a function, not a direct update: enquiries grants UPDATE on four
    // graded columns only, because everything else on it is the recompute
    // trigger's to own. set_ticket_fields can reach these three and nothing
    // else. Escalation is opted into separately, so a save that is not about
    // escalating leaves the name already on the ticket alone.
    const { error } = await supabase.rpc("set_ticket_fields", {
      p_enquiry_id: targetEnquiryId,
      p_order_id: input.ticketOrderId?.trim() || undefined,
      p_product: input.ticketProduct?.trim() || undefined,
      p_teacher_id: input.ticketTeacherId || undefined,
      p_touch_escalated: input.escalatedTo !== undefined,
      p_escalated_to: input.escalatedTo || undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) return { error: `Could not save the ticket details: ${error.message}` };
  }

  // §49.2. The product text, when the first-call form sent one. Purchase or
  // ticket — a ticket's copy goes through set_ticket_fields above, so this
  // only ever fires for the lead case, but the function takes either rather
  // than making the caller know which.
  if (input.productText !== undefined && type !== "after_sale") {
    const { error } = await supabase.rpc("set_product_text", {
      p_enquiry_id: targetEnquiryId,
      p_product: input.productText,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) return { error: `Could not save the product text: ${error.message}` };
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
    // §77.3. Only the sale moves: called_by above is untouched.
    credited_to: outcome === "purchased" ? (input.creditedTo ?? null) : null,
  })
    // called_at is a column default, so the only way to know the instant the
    // database recorded is to read it back. The claim below is stamped with it.
    // The id comes back for §70.1's assignment stamp.
    .select("id, called_at")
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

  /**
   * §70.1. Record which assignment this call was made under.
   *
   * Written after the claim above, not before, because for a lead nobody had
   * been given the claim *is* the assignment the call was made under — it is
   * created by this very call.
   *
   * (enquiry_id, date) is unique, so "the assignment for this enquiry today" is
   * exactly one row and there is nothing to choose between. That is deliberately
   * not the same as "the caller's assignment": a counsellor ringing a lead from
   * somebody else's batch really did make the call under that batch, and the
   * report should say so rather than reaching for a stale row of their own.
   *
   * Best effort. The call is already saved and is the record that matters; a
   * failure here costs the report a recorded link and falls back to inferring
   * one, which is what every call before this column does anyway.
   */
  if (savedCall?.id) {
    const { data: under } = await supabase
      .from("assignments")
      .select("id, bucket")
      .eq("enquiry_id", targetEnquiryId)
      .eq("date", istToday())
      .maybeSingle();
    if (under?.id) {
      const { error: stampError } = await supabase
        .from("calls")
        // The bucket as well as the row: the desk upserts on (enquiry_id, date),
        // so re-handing this lead later today would otherwise rewrite what this
        // call was made under (§70.1).
        .update({ assignment_id: under.id, assignment_bucket: under.bucket })
        .eq("id", savedCall.id);
      if (stampError) {
        console.error("Could not record the call's assignment:", stampError.message);
      }
    }
  }

  // §49.2. A call has been logged on this lead, which means a person has had
  // the conversation the guesses were about. Whatever they left standing they
  // left standing on purpose, so the lines stop being provisional.
  await clearAutoFlag(targetEnquiryId);

  const mobile = (enquiry.students as { mobile: string } | null)?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/quick-add");
  revalidatePath("/my-day");
  revalidatePath("/new-calls");

  if (convertedTo) {
    // §38. Nothing was converted, so nothing says it was. The message names
    // both records, because the counsellor is now looking at a different one
    // from the one they opened and should not have to work that out.
    return {
      error: null,
      ok:
        input.convertToPurchase
          ? `Call logged on purchase enquiry #${convertedTo}. Ticket #${input.enquiryId} is untouched and still open.`
          : `Call logged on ticket #${convertedTo}. Purchase enquiry #${input.enquiryId} is untouched.`,
      convertedTo,
    };
  }

  /**
   * §62.2. An after-sale call hands the enquiry to Support.
   *
   * The call itself is written above and stays in counselling, because it
   * happened and the student's history should say so. What changes is where the
   * work goes next: a ticket is raised carrying the outcome the counsellor
   * chose, and the enquiry closes as handed_to_support so it stops appearing as
   * live counselling work in two places.
   *
   * Done after the call rather than instead of it, so app.recompute_enquiry has
   * already run on the outcome and the close is the last word — which the
   * recompute's own guard on handed_to_support then keeps.
   *
   * This path exists for the enquiries already in the old after-sale pipeline.
   * Nothing new enters it: the convert door above raises a ticket directly.
   */
  if (type === "after_sale") {
    const student = enquiry.student_id as string;
    const { error: raiseError, raised } = await raiseTicketFromCounselling(supabase, {
      studentId: student,
      enquiryId: targetEnquiryId,
      orderId: orderId,
      discussion: input.discussion,
      issueCategory: input.issueCategory || null,
      outcome: outcome as
        | "noted"
        | "working"
        | "escalated"
        | "pending_institute"
        | "resolved",
      followUpDate: input.nextFollowUpDate || null,
      escalatedTo: input.escalatedTo ?? null,
      teacherId: input.ticketTeacherId ?? null,
      closeEnquiry: true,
    });
    // The call is already saved. A failure here must say so plainly rather than
    // implying nothing happened.
    if (raiseError) {
      return {
        error: `The call was logged, but the support ticket was not created: ${raiseError}`,
      };
    }

    revalidatePath("/support");
    revalidatePath("/tickets");
    return {
      error: null,
      ok: `Call logged and support ticket #${raised!.ticketId} created. Enquiry #${targetEnquiryId} is now handed to Support.`,
      supportTicketId: raised!.ticketId,
      existingSupportTicketId: raised!.existingOpenTicket ?? undefined,
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

  // §39.2: a line is worth keeping as soon as it names anything.
  const lines = input.lines.filter(
    (l) => l.teacherId || l.courseId || l.subjectId || l.contentId,
  );
  if (!lines.length) {
    return {
      error: "An interest line needs at least one of teacher, course, subject or content.",
    };
  }
  if (lines.some((l) => l.subjectId && !l.courseId)) {
    return { error: "A subject needs its course chosen too." };
  }

  const supabase = await createClient();

  const [{ data: enquiry, error: findError }, { data: present }] = await Promise.all([
    supabase
      .from("enquiries")
      .select("id, students ( mobile )")
      .eq("id", input.enquiryId)
      .maybeSingle(),
    supabase
      .from("enquiry_items")
      .select("teacher_id, course_id, subject_id, content_id")
      .eq("enquiry_id", input.enquiryId)
      .eq("status", "open"),
  ]);

  if (findError) return { error: findError.message };
  if (!enquiry) return { error: "That enquiry no longer exists." };

  // §47.1. De-duped on the whole combination, against the lead as well as
  // within this batch. Silent: somebody asking for a line the lead already has
  // wants it there, and it is.
  const fresh = dropDuplicateLines(lines, new Set((present ?? []).map(rowShape)));
  if (!fresh.length) {
    return { error: null, ok: "Those interests were already on this lead." };
  }

  const { error } = await supabase.from("enquiry_items").insert(
    fresh.map((l) => ({
      enquiry_id: input.enquiryId,
      teacher_id: l.teacherId || null,
      course_id: l.courseId || null,
      subject_id: l.subjectId || null,
      content_id: l.contentId || null,
      created_by: viewer.userId,
      status: "open" as const,
    })),
  );

  if (error) return { error: `Could not save the interests: ${error.message}` };

  // §49.2. Somebody has added a line by hand, so the parser's guesses on this
  // lead have been seen and stand or fall on that person's judgement now.
  await clearAutoFlag(input.enquiryId);

  const mobile = (enquiry.students as { mobile: string } | null)?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/enquiries");

  return {
    error: null,
    ok: `Added ${fresh.length} interest${fresh.length === 1 ? "" : "s"}.`,
  };
}

/**
 * Correct a saved interest line, or take it off the lead (§39.3).
 *
 * The same four columns it was created with, changeable a week later: §39.2
 * lets a line be recorded before it is complete, and a line that could never
 * be completed afterwards would just be a worse version of not recording it.
 *
 * Removal closes the line rather than deleting it. An interest somebody
 * recorded and then withdrew is a fact about the lead — the teacher-wise
 * reports read closed lines as interest that went nowhere — and a deleted row
 * takes that with it. It is also the only way an audit trail survives a
 * correction.
 *
 * A won line is refused. It carries an order id and an amount, and rewriting
 * what was bought after the money is recorded is not a correction.
 *
 * The enquiry's own status is not touched here: the trigger on enquiry_items
 * fires app.recompute_enquiry(), which is the only thing allowed to decide it.
 */
export async function updateEnquiryItem(input: {
  itemId: string;
  teacherId: string | null;
  courseId: string | null;
  subjectId: string | null;
  contentId: string | null;
}): Promise<LogCallResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const teacherId = input.teacherId || null;
  const courseId = input.courseId || null;
  const subjectId = input.subjectId || null;
  const contentId = input.contentId || null;

  if (!teacherId && !courseId && !subjectId && !contentId) {
    return {
      error:
        "An interest line needs at least one of teacher, course, subject or content. Remove it instead.",
    };
  }
  if (subjectId && !courseId) {
    return { error: "A subject needs its course chosen too." };
  }

  const supabase = await createClient();
  const { data: item, error: findError } = await supabase
    .from("enquiry_items")
    .select("id, status, enquiry_id, enquiries ( students ( mobile ) )")
    .eq("id", input.itemId)
    .maybeSingle();

  if (findError) return { error: findError.message };
  if (!item) return { error: "That interest line no longer exists." };
  if (item.status === "won") {
    return { error: "A line that was bought cannot be changed." };
  }

  const { error } = await supabase
    .from("enquiry_items")
    .update({
      teacher_id: teacherId,
      course_id: courseId,
      subject_id: subjectId,
      content_id: contentId,
    })
    .eq("id", input.itemId);

  if (error) return { error: `Could not save the line: ${error.message}` };

  // §49.2. Editing one line verifies them all: the counsellor was looking at
  // the whole set when they decided this one was wrong, so the ones they left
  // alone have been confirmed as surely as the one they changed.
  await clearAutoFlag(item.enquiry_id);

  const mobile = (
    item.enquiries as { students: { mobile: string } | null } | null
  )?.students?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/enquiries");

  return { error: null, ok: "Line updated." };
}

/** Take a line off the lead. Closed, never deleted — see updateEnquiryItem. */
export async function removeEnquiryItem(input: {
  itemId: string;
}): Promise<LogCallResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const supabase = await createClient();
  const { data: item, error: findError } = await supabase
    .from("enquiry_items")
    .select("id, status, enquiry_id, enquiries ( students ( mobile ) )")
    .eq("id", input.itemId)
    .maybeSingle();

  if (findError) return { error: findError.message };
  if (!item) return { error: "That interest line no longer exists." };
  if (item.status === "won") {
    return { error: "A line that was bought cannot be removed." };
  }

  const { error } = await supabase
    .from("enquiry_items")
    .update({ status: "closed" as const })
    .eq("id", input.itemId);

  if (error) return { error: `Could not remove the line: ${error.message}` };

  // Taking a wrong line off is the same act of verification as fixing one.
  await clearAutoFlag(item.enquiry_id);

  const mobile = (
    item.enquiries as { students: { mobile: string } | null } | null
  )?.students?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/enquiries");

  return { error: null, ok: "Line removed." };
}

export type EditCallInput = {
  callId: number;
  outcome: CallOutcome;
  discussion: string;
  nextFollowUpDate: string | null;
  importance: Importance | "" | null;
  leadVerification: LeadVerification | "" | null;
};

/**
 * Correct a call that was logged wrongly (§29.4).
 *
 * The permission is the database's, not this function's: calls_update already
 * says an admin may change any call and everybody else only their own, only on
 * the day they made it. So this does not re-implement that rule — it writes,
 * and a refusal comes back as a refusal. Re-checking here would be a second
 * copy of a rule that can only disagree with the first.
 *
 * The audit trigger records the change and the recompute trigger settles the
 * enquiry afterwards, so an outcome corrected from follow-up to call back
 * moves the lead's status and next date without anything here saying so.
 */
export async function editCall(input: EditCallInput): Promise<LogCallResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  if (!input.discussion.trim() && input.outcome === "follow_up" && !input.nextFollowUpDate) {
    return { error: "A follow-up needs a next follow-up date." };
  }

  const supabase = await createClient();

  const { data: call, error: readError } = await supabase
    .from("calls")
    // Named FK: calls reaches enquiries twice — by id and by the composite
    // (enquiry_id, enquiry_type) — and PostgREST will not guess.
    .select(
      "id, enquiry_id, enquiry_type, enquiry:enquiries!calls_enquiry_id_fkey ( student_id, students ( mobile ) )",
    )
    .eq("id", input.callId)
    .maybeSingle();

  if (readError) return { error: readError.message };
  if (!call) return { error: "That call no longer exists." };

  const type = call.enquiry_type as EnquiryType;
  if (!outcomesFor(type).includes(input.outcome)) {
    return { error: "That outcome does not apply to this kind of enquiry." };
  }
  if (input.outcome === "follow_up" && !input.nextFollowUpDate) {
    return { error: "A follow-up needs a next follow-up date." };
  }

  const { error, count } = await supabase
    .from("calls")
    .update(
      {
        outcome: input.outcome,
        discussion: input.discussion.trim() || null,
        next_follow_up_date: input.nextFollowUpDate || null,
      },
      { count: "exact" },
    )
    .eq("id", input.callId);

  if (error) return { error: `Could not save the change: ${error.message}` };
  if (!count) {
    // RLS matched nothing: somebody else's call, or not today's.
    return {
      error:
        "You can only edit your own calls, and only on the day you made them. Ask an admin to correct an older one.",
    };
  }

  // The grading belongs to the enquiry rather than the call, and is corrected
  // alongside it because that is where the counsellor sees it.
  const nextImportance = (input.importance || null) as Importance | null;
  const nextLead = (input.leadVerification || null) as LeadVerification | null;
  const { error: gradeError } = await supabase
    .from("enquiries")
    .update({ importance: nextImportance, lead_verification: nextLead })
    .eq("id", call.enquiry_id);
  if (gradeError) console.error("Could not save the grading:", gradeError.message);

  const mobile = (call.enquiry as { students?: { mobile?: string } } | null)?.students?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/my-day");
  revalidatePath("/quick-add");
  revalidatePath("/tickets");

  return { error: null, ok: "Call updated." };
}

/* -------------------------------------------------------------------------- */
/* The edit history of one call (§35.3)                                       */
/* -------------------------------------------------------------------------- */

export type CallEdit = {
  changedAt: string;
  actorName: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

/**
 * What was changed on a call, and by whom.
 *
 * Read through call_edits(), which is security definer: the audit log itself
 * is admin-only, and the person who most needs to know a note was rewritten is
 * the counsellor reading the note. The function returns only the fields the
 * history already shows, so nothing leaks out of it that is not on the screen.
 */
export async function loadCallEdits(
  callId: number,
): Promise<{ error: string | null; edits?: CallEdit[] }> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("call_edits", {
    p_call_id: callId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };

  return {
    error: null,
    edits: ((data ?? []) as unknown as {
      changed_at: string;
      actor_name: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
    }[]).map((r) => ({
      changedAt: r.changed_at,
      actorName: r.actor_name,
      field: r.field,
      oldValue: r.old_value,
      newValue: r.new_value,
    })),
  };
}

/**
 * The ticket's own fields, corrected after the fact (§47.2).
 *
 * Separate from updateEnquiryDetails because the two write through different
 * doors. That one goes straight at `enquiries`, which grants UPDATE on exactly
 * four columns; these four are not among them, so they go through
 * set_ticket_fields, which is security definer and checks app.is_staff()
 * itself. "Any staff" is the brief's phrase and that function is where it is
 * enforced — not here, and not by the button being on screen.
 *
 * p_replace is what makes this an editor rather than an appender: the panel
 * sends the fields a call touched and means "leave the rest", this sends the
 * whole set and means it, so a wrong order id can be cleared and not just
 * overwritten.
 */
export async function updateTicketFields(input: {
  enquiryId: number;
  orderId: string | null;
  product: string | null;
  teacherId: string | null;
  issueCategory: IssueCategory | "" | null;
}): Promise<LogCallResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ticket_fields", {
    p_enquiry_id: input.enquiryId,
    p_order_id: input.orderId?.trim() || null,
    p_product: input.product?.trim() || null,
    p_teacher_id: input.teacherId || null,
    p_replace: true,
    // The category is on the call, so it is only touched when one was chosen.
    // Sending null with the flag set would blank a category rather than leave
    // it, which is not what an untouched select means.
    p_touch_issue: Boolean(input.issueCategory),
    p_issue_category: (input.issueCategory || null) as IssueCategory | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: `Could not save the ticket details: ${error.message}` };

  const { data: enquiry } = await supabase
    .from("enquiries")
    .select("students ( mobile )")
    .eq("id", input.enquiryId)
    .maybeSingle();
  const mobile = (enquiry?.students as { mobile: string } | null)?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/tickets");
  revalidatePath("/my-day");

  return { error: null, ok: "Ticket details saved." };
}

/**
 * §77.3. Move a sale's credit.
 *
 * Admins only — a super_admin or manager reading the report is the person who
 * knows the sale landed on the wrong row. The call's own attribution never moves:
 * called_by is untouched, so the caller keeps the call and only the sale travels.
 *
 * No event table of its own. public.calls carries z_audit_calls, so the before
 * and after are in audit_log with the actor already — writing a second record
 * beside it would be two accounts of one change, and they would eventually differ.
 */
export async function changeSaleCredit(input: {
  callId: number;
  /** Null hands the sale back to whoever made the call. */
  creditedTo: string | null;
}): Promise<{ error: string | null; ok?: string }> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!["super_admin", "manager"].includes(viewer.profile.role)) {
    return { error: "Only a Super Admin or Manager can move a sale's credit." };
  }

  const supabase = await createClient();
  const { data: call, error: findError } = await supabase
    .from("calls")
    .select("id, outcome, enquiry_id")
    .eq("id", input.callId)
    .maybeSingle();
  if (findError) return { error: findError.message };
  if (!call) return { error: "That call no longer exists." };
  // Only a sale has a credit to move; anything else would be recording a fact
  // about a call that never made one.
  if (call.outcome !== "purchased") {
    return { error: "Only a purchased call carries a sale to credit." };
  }

  const { error } = await supabase
    .from("calls")
    .update({ credited_to: input.creditedTo })
    .eq("id", input.callId);
  if (error) return { error: `Could not move the credit: ${error.message}` };

  revalidatePath("/reports");
  revalidatePath("/my-day");
  return { error: null, ok: "Credit moved." };
}
