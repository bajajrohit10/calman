"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type {
  EnquiryStatus,
  EnquiryType,
  Importance,
  LeadVerification,
} from "@/lib/enquiry-labels";
import { lookupNumbers } from "@/app/(app)/import/actions";
import { describeNumber, type DuplicateCase } from "@/lib/duplicate-rules";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";
import { fillBlankStudentName } from "@/lib/student-name";
import { loadStudentByMobile, type StudentHistory } from "@/lib/students";
import { createClient } from "@/lib/supabase/server";

export type LookupResult = {
  error: string | null;
  mobile: string;
  student: StudentHistory | null;
};

/**
 * §5.1 live lookup. Called on every keystroke once ten digits are present, so
 * it does exactly one query and returns the same shape the history panel and
 * the /students page already render.
 */
export async function lookupMobile(raw: string): Promise<LookupResult> {
  const mobile = normaliseMobile(raw);
  if (!isValidMobile(mobile)) {
    return { error: "That is not a valid Indian mobile number.", mobile, student: null };
  }

  // Both at once (§28.2). The lookup used to await the session and only then
  // ask for the history — two serial crossings on the one interaction where a
  // counsellor is waiting with the phone already ringing. They do not depend
  // on each other: RLS is what decides whether the history comes back at all,
  // and requireUser is the redirect for somebody who is not signed in. So they
  // race, and the authorisation is still checked before anything is returned.
  try {
    const [, student] = await Promise.all([
      requireUser(),
      loadStudentByMobile(mobile),
    ]);
    return { error: null, mobile, student };
  } catch (e) {
    return { error: (e as Error).message, mobile, student: null };
  }
}

export type NewEnquiryInput = {
  mobile: string;
  name: string | null;
  type: EnquiryType;
  sourceId: string | null;
  productText: string | null;
  termId: string | null;
  importance: Importance | "" | null;
  leadVerification: LeadVerification | "" | null;
  /** Set when replacing an open enquiry: it is closed as superseded first. */
  supersedeEnquiryId: number | null;
};

export type NewEnquiryResult = {
  error: string | null;
  enquiry?: {
    id: number;
    type: EnquiryType;
    studentName: string | null;
    mobile: string;
    term: string | null;
    productText: string | null;
    slotsUsed: number;
    termId: string | null;
    sourceId: string | null;
    importance: Importance | null;
    leadVerification: LeadVerification | null;
    defaultFollowUpDate: string | null;
    status: EnquiryStatus;
    sourceNames: string[];
    nextFollowUpDate: string | null;
    reEnquiredAt: string | null;
    createdAt: string;
    timeline: never[];
    items: never[];
  };
};

/**
 * Create the enquiry Quick Add is about to log a call against, creating the
 * student too if this number has never been seen (§5.1).
 *
 * The mobile number is the only required field in the entire system (§3), so
 * everything else here is allowed to be null and filled in later.
 */
export async function createEnquiry(
  input: NewEnquiryInput,
): Promise<NewEnquiryResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const mobile = normaliseMobile(input.mobile);
  if (!isValidMobile(mobile)) return { error: "That is not a valid Indian mobile number." };

  const supabase = await createClient();

  // --- the student ---------------------------------------------------------
  const { data: existing, error: findError } = await supabase
    .from("students")
    .select("id, name")
    .eq("mobile", mobile)
    .maybeSingle();

  if (findError) return { error: findError.message };

  let studentId = existing?.id ?? null;
  let studentName = existing?.name ?? null;

  if (!studentId) {
    const { data, error } = await supabase
      .from("students")
      .insert({
        mobile,
        name: input.name?.trim() || null,
        created_by: viewer.userId,
      })
      .select("id, name")
      .single();

    if (error) return { error: `Could not create the student: ${error.message}` };
    studentId = data.id;
    studentName = data.name;
  }

  // --- supersede the previous enquiry, if asked ----------------------------
  // §4.9: a human decision the recompute trigger deliberately will not undo.
  // RLS on enquiries only lets an admin (or same-day creator) update a row,
  // so this goes through the definer function added for exactly this case.
  if (input.supersedeEnquiryId != null) {
    const { error } = await supabase.rpc("supersede_enquiry", {
      p_enquiry_id: input.supersedeEnquiryId,
    });
    if (error) return { error: `Could not close the previous enquiry: ${error.message}` };
  }

  // --- the enquiry ---------------------------------------------------------
  const { data: enquiry, error: enquiryError } = await supabase
    .from("enquiries")
    .insert({
      student_id: studentId,
      type: input.type,
      source_id: input.sourceId || null,
      product_text: input.productText?.trim() || null,
      term_id: input.termId || null,
      importance: input.importance || null,
      lead_verification: input.leadVerification || null,
      created_by: viewer.userId,
    })
    .select("id, type, term:terms ( name )")
    .single();

  if (enquiryError) return { error: `Could not create the enquiry: ${enquiryError.message}` };

  // §10.1: the source log records every arrival, and a number typed into Quick
  // Add is an arrival. Nothing about the Quick Add flow changes — the
  // counsellor still chooses what happens — this only stops the log having a
  // hole where the hand-entered leads should be.
  const { error: sourceLogError } = await supabase.from("enquiry_sources").insert({
    enquiry_id: enquiry.id,
    source_id: input.sourceId || null,
    note: "Added in Quick Add.",
  });
  // Not fatal: the enquiry exists, and the counsellor has a call to log.
  if (sourceLogError) console.error("enquiry_sources insert failed", sourceLogError.message);

  const { data: nextDay } = await supabase.rpc("next_working_day", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  revalidatePath(`/students/${mobile}`);
  revalidatePath("/quick-add");

  return {
    error: null,
    enquiry: {
      id: enquiry.id,
      type: enquiry.type as EnquiryType,
      studentName,
      mobile,
      term: (enquiry.term as { name: string } | null)?.name ?? null,
      productText: input.productText?.trim() || null,
      // A brand-new enquiry has had no calls, so it is at the fresh stage.
      slotsUsed: 0,
      termId: input.termId || null,
      sourceId: input.sourceId || null,
      importance: (input.importance || null) as Importance | null,
      leadVerification: (input.leadVerification || null) as LeadVerification | null,
      defaultFollowUpDate: (nextDay as string | null) ?? null,
      // A brand-new enquiry: open, no calls, and the only source is the one
      // just chosen. The panel's timeline still shows the student's other
      // enquiries when there are any — Quick Add fills that in below.
      status: "open" as EnquiryStatus,
      sourceNames: [],
      nextFollowUpDate: null,
      reEnquiredAt: null,
      createdAt: new Date().toISOString(),
      timeline: [],
      items: [],
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The grid (§30.1, Brief 31)                                                 */
/* -------------------------------------------------------------------------- */

export type BulkRowInput = {
  mobile: string;
  name: string | null;
  type: EnquiryType;
  sourceId: string | null;
  /**
   * Case 5 only (Brief 31): a number somebody has already called today does
   * nothing until a person chooses. Every other case is decided by the rules,
   * so there is nothing here to send.
   */
  decision: "dismiss" | "add_anyway" | null;
};

export type BulkRowResult = {
  mobile: string;
  /** Which of the five, as the server saw it at save time. */
  case: DuplicateCase | null;
  action: "created" | "updated" | "returned" | "dismissed" | "failed";
  enquiryId: number | null;
  /** What happened, in the words the rule uses. */
  detail?: string;
  reason?: string;
  /** Anything typed that this save could not apply (§30.3). */
  ignored?: string[];
};

export type BulkResult = {
  error: string | null;
  rows?: BulkRowResult[];
  created?: number;
  updated?: number;
  returned?: number;
  dismissed?: number;
  failed?: { mobile: string; reason: string }[];
};

/**
 * Save a screenful of numbers under §10.1's rules (Brief 31).
 *
 * The rules are applied here, from a lookup taken now, rather than from
 * whatever the grid saw when the number was typed. Two reasons: a colleague
 * may have called the number in the minutes since, and a classification that
 * arrives from a browser is a classification anybody can send. The grid's job
 * is to show what will happen and to collect the one decision the rules cannot
 * make; the deciding is here.
 *
 * Rows are written one at a time because each takes a different branch — a new
 * student, an open enquiry taking a source, a follow-up coming back to the
 * pool — and a failure is reported against its own number while the rest go in.
 */
export async function createManyEnquiries(
  rows: BulkRowInput[],
): Promise<BulkResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!rows.length) return { error: "Nothing to save." };
  if (rows.length > 100) return { error: "That is more than 100 rows. Save in batches." };

  const supabase = await createClient();

  // One lookup for the whole grid, taken now.
  const purchase = rows.filter((r) => r.type !== "after_sale");
  const { statuses, error: lookupError } = await lookupNumbers(
    [...new Set(purchase.map((r) => normaliseMobile(r.mobile)).filter(isValidMobile))],
  );
  if (lookupError) return { error: lookupError };
  const known = new Map((statuses ?? []).map((s) => [s.mobile, s]));

  const out: BulkRowResult[] = [];

  for (const row of rows) {
    const mobile = normaliseMobile(row.mobile);
    if (!isValidMobile(mobile)) {
      out.push({
        mobile: row.mobile,
        case: null,
        action: "failed",
        enquiryId: null,
        reason: "not a valid Indian mobile number",
      });
      continue;
    }

    // An after-sale row is not a lead at all: tickets are worked in Tickets,
    // never in the New Calls pool, so none of the five cases applies to one.
    if (row.type === "after_sale") {
      out.push(await createFresh(mobile, row, null));
      continue;
    }

    const status = known.get(mobile);
    const verdict = status ? describeNumber(status) : null;
    const which = verdict?.case ?? 1;

    if (which === 5) {
      if (row.decision === "dismiss") {
        out.push({
          mobile,
          case: 5,
          action: "dismissed",
          enquiryId: status?.openEnquiryId ?? null,
          detail: "Left alone; the call made today stands.",
        });
        continue;
      }
      if (row.decision !== "add_anyway") {
        out.push({
          mobile,
          case: 5,
          action: "failed",
          enquiryId: null,
          reason: "somebody called this number today — choose Dismiss or Add to New Calls anyway",
        });
        continue;
      }
    }

    // Cases 1 and 2: nothing is open, so this is a fresh lead in the pool.
    if (which === 1 || which === 2) {
      out.push(await createFresh(mobile, row, which));
      continue;
    }

    // Cases 3, 4 and a case 5 that was waved through: the same enquiry takes
    // the new source. Case 3 stays exactly where it is; the other two clear
    // the follow-up and come back to the pool.
    const enquiryId = status?.openEnquiryId ?? null;
    if (!enquiryId) {
      out.push({
        mobile,
        case: which,
        action: "failed",
        enquiryId: null,
        reason: "the open enquiry disappeared between the lookup and the save",
      });
      continue;
    }

    const returns = which !== 3;
    const { data, error } = await supabase.rpc("import_re_enquire", {
      p_enquiry_id: enquiryId,
      p_source_id: row.sourceId ?? undefined,
      p_clear_follow_up: returns,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (error) {
      out.push({
        mobile,
        case: which,
        action: "failed",
        enquiryId: null,
        reason: error.message,
      });
      continue;
    }

    const ignored: string[] = [];
    const named = await fillBlankStudentName(supabase, status?.studentId ?? null, row.name);
    if (named.keptExisting) {
      ignored.push(`Name stays "${named.keptExisting}" — this number already has one`);
    }
    if (named.error) ignored.push(`Name could not be set: ${named.error}`);

    out.push({
      mobile,
      case: which,
      action: returns ? "returned" : "updated",
      enquiryId,
      detail: (data as string | null) ?? undefined,
      ignored: ignored.length ? ignored : undefined,
    });
  }

  // New purchase leads land unassigned, which is what puts them in New Calls:
  // the pool is "open, never had a fresh call, on nobody's day".
  revalidatePath("/new-calls");
  revalidatePath("/quick-add");
  revalidatePath("/tickets");

  return {
    error: null,
    rows: out,
    created: out.filter((r) => r.action === "created").length,
    updated: out.filter((r) => r.action === "updated").length,
    returned: out.filter((r) => r.action === "returned").length,
    dismissed: out.filter((r) => r.action === "dismissed").length,
    failed: out
      .filter((r) => r.action === "failed")
      .map((r) => ({ mobile: r.mobile, reason: r.reason ?? "could not be saved" })),
  };
}

/** Cases 1 and 2, and every after-sale row: a brand-new enquiry. */
async function createFresh(
  mobile: string,
  row: BulkRowInput,
  which: DuplicateCase | null,
): Promise<BulkRowResult> {
  const res = await createEnquiry({
    mobile,
    name: row.name,
    type: row.type,
    sourceId: row.sourceId,
    productText: null,
    termId: null,
    importance: null,
    leadVerification: null,
    supersedeEnquiryId: null,
  });

  if (res.error || !res.enquiry) {
    return {
      mobile,
      case: which,
      action: "failed",
      enquiryId: null,
      reason: res.error ?? "could not be saved",
    };
  }
  return { mobile, case: which, action: "created", enquiryId: res.enquiry.id };
}
