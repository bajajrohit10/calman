"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { showsSupport } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { createSupportTicket } from "@/lib/support/create";
import type { Database } from "@/types/database";

/**
 * §58.3d and §58.4. Every write the Support screens make.
 *
 * Each one re-checks the role. The rail hides the section from counsellors and
 * RLS refuses them at the table, but a server action is a public HTTP endpoint
 * and "the link is hidden" has never been an access rule.
 */

export type SupportResult = { error: string | null; ok?: string; ticketId?: number };

type Source = Database["support"]["Enums"]["ticket_source"];
type Status = Database["support"]["Enums"]["ticket_status"];

async function gate() {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." as const, viewer: null };
  if (!showsSupport(viewer.profile.role)) {
    return { error: "You do not have access to Support." as const, viewer: null };
  }
  return { error: null, viewer };
}

/** §58.3d. A ticket a team member types in, through the same path as the form. */
export async function newSupportTicket(input: {
  source: Source;
  studentName?: string | null;
  mobile?: string | null;
  orderId?: string | null;
  issues?: string[] | null;
  issueOther?: string | null;
  description?: string | null;
  faculty?: string | null;
  attachments?: string | null;
}): Promise<SupportResult> {
  const { error, viewer } = await gate();
  if (error || !viewer) return { error: error ?? "Not permitted." };

  if (!(input.mobile ?? "").trim() && !(input.orderId ?? "").trim()) {
    return { error: "A ticket needs a mobile number or an order id." };
  }
  // 'form' is reserved for the webhook: a hand-typed ticket claiming to be a
  // form submission would break the one thing form_row_ref guarantees.
  if (input.source === "form" || input.source === "counselling") {
    return { error: "Choose Mail, WhatsApp, Calling team or Manual." };
  }

  // The create path takes the raw form strings, so the picked checkboxes are
  // re-joined the way Google Forms would have sent them. One parser, one set of
  // rules, whichever door the ticket came through.
  const issuesRaw = [...(input.issues ?? []), (input.issueOther ?? "").trim()]
    .filter(Boolean)
    .join(", ");

  try {
    const supabase = await createClient();
    const result = await createSupportTicket(
      supabase,
      {
        source: input.source,
        studentName: input.studentName ?? null,
        mobile: input.mobile ?? null,
        orderId: input.orderId ?? null,
        issues: issuesRaw || null,
        description: input.description ?? null,
        faculty: input.faculty ?? null,
        attachments: input.attachments ?? null,
        rowRef: null,
      },
      viewer.userId ?? null,
    );
    revalidatePath("/support");
    return {
      error: null,
      ticketId: result.ticketId,
      ok: result.mergedInto
        ? `Ticket #${result.ticketId} created and merged into #${result.mergedInto} — same number and order id.`
        : `Ticket #${result.ticketId} created.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the ticket." };
  }
}

/** §58.4. The action panel: one form, one transaction. */
export async function saveTicketAction(input: {
  ticketId: number;
  issues: string[];
  issueOther: string | null;
  instituteId: string | null;
  teacherId: string | null;
  orderIdWork: string | null;
  details: string;
  outcome: Status;
  followUpDate: string | null;
  escalatedTo: string | null;
  called: boolean;
  messaged: boolean;
}): Promise<SupportResult> {
  const { error } = await gate();
  if (error) return { error };

  const supabase = await createClient();
  const { error: rpcError } = await supabase.schema("support").rpc("save_ticket_action", {
    p_ticket_id: input.ticketId,
    p_issues: input.issues,
    p_issue_other: input.issueOther,
    p_institute_id: input.instituteId,
    p_teacher_id: input.teacherId,
    p_order_id_work: input.orderIdWork,
    p_details: input.details,
    p_outcome: input.outcome,
    p_follow_up_date: input.followUpDate,
    p_escalated_to: input.escalatedTo,
    p_called: input.called,
    p_messaged: input.messaged,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (rpcError) return { error: rpcError.message };
  revalidatePath(`/support/${input.ticketId}`);
  revalidatePath("/support");
  return { error: null, ok: "Saved." };
}

/** §58.4. A touch that changes no outcome: Log call, Log message, Add note. */
export async function logTicketTouch(input: {
  ticketId: number;
  kind: "called" | "messaged" | "note";
  note: string | null;
  picked?: boolean | null;
  channel?: string | null;
}): Promise<SupportResult> {
  const { error } = await gate();
  if (error) return { error };

  const supabase = await createClient();
  const { error: rpcError } = await supabase.schema("support").rpc("log_ticket_touch", {
    p_ticket_id: input.ticketId,
    p_kind: input.kind,
    p_note: input.note,
    p_picked: input.picked ?? null,
    p_channel: input.channel ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (rpcError) return { error: rpcError.message };
  revalidatePath(`/support/${input.ticketId}`);
  return {
    error: null,
    ok: input.kind === "note" ? "Note added." : input.kind === "called" ? "Call logged." : "Message logged.",
  };
}

/** §58.4. Merge into… */
export async function mergeTicket(input: {
  childId: number;
  parentId: number;
}): Promise<SupportResult> {
  const { error } = await gate();
  if (error) return { error };

  const supabase = await createClient();
  const { error: rpcError } = await supabase.schema("support").rpc("merge_ticket", {
    p_child_id: input.childId,
    p_parent_id: input.parentId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (rpcError) return { error: rpcError.message };
  revalidatePath(`/support/${input.childId}`);
  revalidatePath(`/support/${input.parentId}`);
  revalidatePath("/support");
  return { error: null, ok: `Merged into #${input.parentId}.` };
}

/** §58.4. Candidates for "Merge into…" — open tickets sharing a number or order. */
export async function findMergeTargets(input: {
  ticketId: number;
  query: string;
}): Promise<{ error: string | null; rows?: { id: number; label: string }[] }> {
  const { error } = await gate();
  if (error) return { error };

  const q = input.query.trim();
  if (!q) return { error: null, rows: [] };

  const supabase = await createClient();
  const { data, error: listError } = await supabase
    .schema("support")
    .rpc("queue", {
      p_tab: "open",
      p_search: q,
      p_limit: 20,
      p_offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

  if (listError) return { error: listError.message };

  const rows = ((data ?? []) as unknown as {
    id: number;
    student_name: string | null;
    mobile: string | null;
    order_id_work: string | null;
    order_id: string | null;
    status: string;
  }[])
    .filter((r) => r.id !== input.ticketId)
    .map((r) => ({
      id: r.id,
      label: `#${r.id} · ${r.student_name ?? "no name"} · ${r.mobile ?? "no number"} · ${
        r.order_id_work ?? r.order_id ?? "no order"
      }`,
    }));

  return { error: null, rows };
}

/** §58.4. Assign, from the queue or the ticket. */
export async function assignTicket(input: {
  ticketId: number;
  assignedTo: string | null;
}): Promise<SupportResult> {
  const { error, viewer } = await gate();
  if (error || !viewer) return { error: error ?? "Not permitted." };

  const supabase = await createClient();
  const db = supabase.schema("support");
  const { data: before } = await db
    .from("tickets")
    .select("assigned_to")
    .eq("id", input.ticketId)
    .maybeSingle();

  const { error: updateError } = await db
    .from("tickets")
    .update({ assigned_to: input.assignedTo, last_touched_at: new Date().toISOString() })
    .eq("id", input.ticketId);
  if (updateError) return { error: updateError.message };

  if ((before?.assigned_to ?? null) !== input.assignedTo) {
    await db.from("events").insert({
      ticket_id: input.ticketId,
      actor_id: viewer.userId ?? null,
      kind: "field_change",
      detail: { field: "assigned_to", old: before?.assigned_to ?? null, new: input.assignedTo },
    });
  }

  revalidatePath(`/support/${input.ticketId}`);
  revalidatePath("/support");
  return { error: null, ok: "Assigned." };
}
