"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type {
  EnquiryStatus,
  EnquiryType,
  Importance,
  LeadVerification,
} from "@/lib/enquiry-labels";
import { isValidMobile, normaliseMobile } from "@/lib/mobile";
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
/* Add many (§29.3)                                                           */
/* -------------------------------------------------------------------------- */

export type BulkRowInput = {
  mobile: string;
  name: string | null;
  sourceId: string | null;
  /**
   * What to do about a number Calman already knows, using the §10.1 rules the
   * bulk import uses: update the open enquiry, open a second one beside it, or
   * leave the number alone.
   */
  decision: "new" | "update" | "dismiss";
  /** The open enquiry the decision is about, when there is one. */
  enquiryId: number | null;
};

export type BulkResult = {
  error: string | null;
  created?: number;
  updated?: number;
  dismissed?: number;
  failed?: { mobile: string; reason: string }[];
};

/**
 * Create a screenful of numbers in one action (§29.3).
 *
 * A counsellor with a list on a WhatsApp message types them in one at a time
 * today, and the lookup, the decision and the save are three interactions per
 * number. The grid is the same three, done once for the whole list.
 *
 * Rows are written one at a time rather than in one insert: each may take a
 * different branch — a new student, an existing one gaining a second enquiry,
 * an open enquiry taking a new source — and a single statement that has to
 * express all three is a statement nobody can read. A failure is reported
 * against its number and the rest still go in, which is what somebody halfway
 * through a list wants.
 */
export async function createManyEnquiries(
  rows: BulkRowInput[],
): Promise<BulkResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!rows.length) return { error: "Nothing to save." };
  if (rows.length > 100) return { error: "That is more than 100 rows. Save in batches." };

  const supabase = await createClient();
  let created = 0;
  let updated = 0;
  let dismissed = 0;
  const failed: { mobile: string; reason: string }[] = [];

  for (const row of rows) {
    const mobile = normaliseMobile(row.mobile);
    if (!isValidMobile(mobile)) {
      failed.push({ mobile: row.mobile, reason: "not a valid Indian mobile number" });
      continue;
    }

    if (row.decision === "dismiss") {
      dismissed += 1;
      continue;
    }

    // Rule (a)/(b): the number is already here and somebody said update. The
    // source is logged either way — §10.1 keeps every arrival — and the
    // enquiry's own source is only filled in when it was blank, so a re-upload
    // never overwrites what a counsellor established on the phone.
    if (row.decision === "update" && row.enquiryId) {
      const { error } = await supabase.from("enquiry_sources").insert({
        enquiry_id: row.enquiryId,
        source_id: row.sourceId,
        note: "Added again in Quick Add (Add many).",
      });
      if (error) {
        failed.push({ mobile, reason: error.message });
        continue;
      }
      if (row.sourceId) {
        await supabase
          .from("enquiries")
          .update({ source_id: row.sourceId })
          .eq("id", row.enquiryId)
          .is("source_id", null);
      }
      updated += 1;
      continue;
    }

    const res = await createEnquiry({
      mobile,
      name: row.name,
      type: "purchase",
      sourceId: row.sourceId,
      productText: null,
      termId: null,
      importance: null,
      leadVerification: null,
      supersedeEnquiryId: null,
    });

    if (res.error) {
      failed.push({ mobile, reason: res.error });
      continue;
    }
    created += 1;
  }

  // Everything lands unassigned, which is what puts it in New Calls: the pool
  // is "open, never called, nobody holding it today" and none of these has a
  // call or an assignment.
  revalidatePath("/new-calls");
  revalidatePath("/quick-add");

  return { error: null, created, updated, dismissed, failed };
}
