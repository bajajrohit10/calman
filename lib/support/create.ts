import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import {
  facultyCandidates,
  normaliseSupportMobile,
  normaliseSupportOrderId,
  parseSupportAttachments,
  parseSupportIssues,
} from "@/lib/support/normalise";

/**
 * §58.3. The one way a support ticket comes into being.
 *
 * The form webhook and the team's "New ticket" button both land here, because
 * the interesting parts — normalisation, faculty matching, the duplicate probe
 * and the opening events — are the same work whoever started it, and a second
 * copy would be a second set of rules to keep in step. What differs is only the
 * client handed in (service role for the webhook, the signed-in user's for the
 * form) and whether there is an actor to credit.
 */

/**
 * A plain client. The support tables are reached with .schema("support") inside
 * this module, so callers never have to remember to do it — and the faculty
 * match needs public.teachers in the same breath, which a schema-bound client
 * cannot see.
 */
export type SupportClient = SupabaseClient<Database>;

export type CreateTicketInput = {
  source: Database["support"]["Enums"]["ticket_source"];
  /** ISO instant. The form's own timestamp; now() when absent. */
  raisedAt?: string | null;
  studentName?: string | null;
  mobile?: string | null;
  orderId?: string | null;
  issues?: string | null;
  description?: string | null;
  faculty?: string | null;
  attachments?: string | null;
  /** Sheet row identity. Present only for form tickets; the idempotency key. */
  rowRef?: string | null;
};

export type CreateTicketResult = {
  ticketId: number;
  /** True when rowRef had already been seen and nothing was written. */
  existing: boolean;
  /** Set when the new ticket was filed as a duplicate of this one. */
  mergedInto?: number;
  mobile: string | null;
  orderId: string | null;
  instituteId: string | null;
  teacherId: string | null;
};

/**
 * Resolve the form's Faculty/Institute text to a master row.
 *
 * Seeded aliases first, then an exact name match, then nothing. The order
 * matters: the biggest dropdown option is a four-name roster whose *segments*
 * are teachers, so a name-first rule would file 2,286 historic tickets against
 * whichever of the four happened to be checked first instead of against the
 * institute that sells the course.
 */
async function matchFaculty(
  base: SupportClient,
  raw: string | null | undefined,
): Promise<{ instituteId: string | null; teacherId: string | null }> {
  const candidates = facultyCandidates(raw);
  if (!candidates.length) return { instituteId: null, teacherId: null };

  const { data: aliases } = await base
    .schema("support")
    .from("faculty_aliases")
    .select("raw_norm, institute_id, teacher_id")
    .in("raw_norm", candidates);

  // Candidate order is significant — whole string before its parts — so the
  // alias rows are looked up by candidate rather than iterated as returned.
  for (const key of candidates) {
    const hit = (aliases ?? []).find((a) => a.raw_norm === key);
    if (hit) return { instituteId: hit.institute_id, teacherId: hit.teacher_id };
  }

  // No alias. Try the masters by name, case-insensitively, teacher first: a
  // single name in this field is nearly always a person.
  for (const key of candidates) {
    const { data: teacher } = await base
      .from("teachers")
      .select("id")
      .ilike("name", key)
      .limit(1)
      .maybeSingle();
    if (teacher) return { instituteId: null, teacherId: teacher.id };

    const { data: institute } = await base
      .from("institutes")
      .select("id")
      .ilike("name", key)
      .limit(1)
      .maybeSingle();
    if (institute) return { instituteId: institute.id, teacherId: null };
  }

  return { instituteId: null, teacherId: null };
}

export async function createSupportTicket(
  base: SupportClient,
  input: CreateTicketInput,
  actorId: string | null,
): Promise<CreateTicketResult> {
  const db = base.schema("support");
  const rowRef = input.rowRef?.trim() || null;

  // §58.3a. Idempotency, before anything is normalised or written: a webhook
  // that retries — and this one retries twice by design — must not produce a
  // second ticket.
  if (rowRef) {
    const { data: seen } = await db
      .from("tickets")
      .select("id, mobile, order_id, institute_id, teacher_id, parent_ticket_id")
      .eq("form_row_ref", rowRef)
      .maybeSingle();
    if (seen) {
      return {
        ticketId: seen.id,
        existing: true,
        mergedInto: seen.parent_ticket_id ?? undefined,
        mobile: seen.mobile,
        orderId: seen.order_id,
        instituteId: seen.institute_id,
        teacherId: seen.teacher_id,
      };
    }
  }

  const mobile = normaliseSupportMobile(input.mobile);
  const orderId = normaliseSupportOrderId(input.orderId);
  const { issues, other } = parseSupportIssues(input.issues);
  const attachments = parseSupportAttachments(input.attachments);
  const { instituteId, teacherId } = await matchFaculty(base, input.faculty);

  // §58.3b. The duplicate probe. Both halves of the key must be known — a
  // ticket with no order id tells us nothing about which complaint it repeats,
  // and merging on mobile alone would fold a student's unrelated problems into
  // one thread.
  // follow_up_date and escalated_to come back with it, because a child copies
  // the parent's status and those two are what that status has to satisfy — a
  // child inheriting 'escalated' with no escalatee, or 'working' with no date,
  // is refused by the table's own constraints at insert time.
  type Parent = {
    id: number;
    status: Database["support"]["Enums"]["ticket_status"];
    follow_up_date: string | null;
    escalated_to: string | null;
  };
  let parent: Parent | null = null;
  if (mobile && orderId) {
    const { data } = await db
      .from("tickets")
      .select("id, status, follow_up_date, escalated_to")
      .eq("mobile", mobile)
      .eq("order_id", orderId)
      .is("parent_ticket_id", null)
      .neq("status", "resolved")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    parent = data ?? null;
  }

  const now = new Date().toISOString();
  const { data: created, error } = await db
    .from("tickets")
    .insert({
      source: input.source,
      raised_at: input.raisedAt || now,
      student_name: input.studentName?.trim() || null,
      mobile_raw: input.mobile?.trim() || null,
      mobile,
      order_id_raw: input.orderId?.trim() || null,
      order_id: orderId,
      issues_raw: input.issues?.trim() || null,
      issues,
      issue_other: other,
      description: input.description?.trim() || null,
      faculty_raw: input.faculty?.trim() || null,
      attachment_urls: attachments,
      form_row_ref: rowRef,
      // The working copies open as the submitted values, so the team edits a
      // draft rather than retyping the student's answer.
      order_id_work: orderId,
      issues_work: issues,
      issue_other_work: other,
      institute_id: instituteId,
      teacher_id: teacherId,
      // A child copies the parent's state: it is the same complaint, and a
      // duplicate showing "new" beside a parent being worked would read as two
      // different situations. The probe only ever finds an unresolved parent,
      // so the resolved-needs-a-timestamp constraint cannot fire here.
      status: parent ? parent.status : "new",
      follow_up_date: parent?.follow_up_date ?? null,
      escalated_to: parent?.escalated_to ?? null,
      parent_ticket_id: parent?.id ?? null,
      merged_at: parent ? now : null,
      last_touched_at: now,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create the ticket: ${error.message}`);
  const ticketId = created.id;

  const events: Database["support"]["Tables"]["events"]["Insert"][] = [
    {
      ticket_id: ticketId,
      actor_id: actorId,
      kind: "created",
      detail: {
        source: input.source,
        mobile_raw: input.mobile ?? null,
        mobile,
        order_id_raw: input.orderId ?? null,
        order_id: orderId,
        issues,
        issue_other: other,
        faculty_raw: input.faculty ?? null,
        institute_id: instituteId,
        teacher_id: teacherId,
        attachments: attachments.length,
        form_row_ref: rowRef,
      },
    },
  ];

  if (parent) {
    events.push({
      ticket_id: ticketId,
      actor_id: actorId,
      kind: "merged_into",
      detail: { ticket_id: parent.id, reason: "same mobile and order id", automatic: true },
    });
    events.push({
      ticket_id: parent.id,
      actor_id: actorId,
      kind: "child_merged",
      detail: { ticket_id: ticketId, reason: "same mobile and order id", automatic: true },
    });
  }

  const { error: eventError } = await db.from("events").insert(events);
  if (eventError) throw new Error(`Ticket ${ticketId} saved, but its history did not: ${eventError.message}`);

  if (parent) {
    await db.from("tickets").update({ last_touched_at: now }).eq("id", parent.id);
  }

  return {
    ticketId,
    existing: false,
    mergedInto: parent?.id,
    mobile,
    orderId,
    instituteId,
    teacherId,
  };
}
