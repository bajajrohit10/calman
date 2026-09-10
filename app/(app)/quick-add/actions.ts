"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import type { EnquiryType, Importance, LeadVerification } from "@/lib/enquiry-labels";
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
  await requireUser();

  const mobile = normaliseMobile(raw);
  if (!isValidMobile(mobile)) {
    return { error: "That is not a valid Indian mobile number.", mobile, student: null };
  }

  try {
    return { error: null, mobile, student: await loadStudentByMobile(mobile) };
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
    termId: string | null;
    sourceId: string | null;
    importance: Importance | null;
    leadVerification: LeadVerification | null;
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
      termId: input.termId || null,
      sourceId: input.sourceId || null,
      importance: (input.importance || null) as Importance | null,
      leadVerification: (input.leadVerification || null) as LeadVerification | null,
      items: [],
    },
  };
}
