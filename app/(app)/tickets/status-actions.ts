"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { TICKET_STATES, type TicketState } from "@/lib/enquiry-labels";
import { createClient } from "@/lib/supabase/server";

export type TicketStatusResult = { error: string | null; ok?: string };

/**
 * Move a ticket from its row (§44b.1).
 *
 * The same path as the call window, not a shortcut past it: a status is
 * derived by app.recompute_enquiry() from the latest call, so moving a ticket
 * *is* logging a call. Writing the status directly would produce a row the
 * recompute would overturn on the next call, and would leave no note saying
 * why it moved.
 *
 * What the row supplies that the window asks for by hand: the issue category
 * and the order id are carried forward from the ticket itself, because they
 * are facts about the complaint that do not change when its state does.
 */
export async function setTicketStatus(input: {
  enquiryId: number;
  status: TicketState;
  /** Required for Escalated; ignored otherwise. */
  escalatedTo?: string | null;
  /** Required for Resolved — a ticket closed with no word on how is a lost record. */
  note?: string | null;
}): Promise<TicketStatusResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };

  const state = TICKET_STATES.find((s) => s.id === input.status);
  if (!state) return { error: "Unknown ticket status." };
  if (input.status === "escalated" && !input.escalatedTo) {
    return { error: "Say who this ticket is escalated to." };
  }
  if (input.status === "closed" && !input.note?.trim()) {
    return { error: "Say in one line how this was resolved." };
  }

  const supabase = await createClient();
  const { data: enquiry, error: findError } = await supabase
    .from("enquiries")
    .select("id, type, order_id, students ( mobile )")
    .eq("id", input.enquiryId)
    .maybeSingle();

  if (findError) return { error: findError.message };
  if (!enquiry) return { error: "That ticket no longer exists." };
  if (enquiry.type !== "after_sale") return { error: "That enquiry is not a ticket." };
  if (!enquiry.order_id) {
    return {
      error:
        "This ticket has no order ID yet. Open it and add one before changing its status.",
    };
  }

  // The category the ticket is already about. after_sale calls carry one, and
  // a status change is not the moment to re-ask a question already answered.
  const { data: lastCall } = await supabase
    .from("calls")
    .select("issue_category")
    .eq("enquiry_id", input.enquiryId)
    .eq("enquiry_type", "after_sale")
    .not("issue_category", "is", null)
    .order("called_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Escalation first: the name has to be on the row before the call fires the
  // recompute, or the event records an escalation to nobody.
  if (input.status === "escalated") {
    const { error } = await supabase.rpc("set_ticket_fields", {
      p_enquiry_id: input.enquiryId,
      p_touch_escalated: true,
      p_escalated_to: input.escalatedTo ?? undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) return { error: `Could not set the escalatee: ${error.message}` };
  }

  const { error: callError } = await supabase.from("calls").insert({
    enquiry_id: input.enquiryId,
    enquiry_type: "after_sale" as const,
    called_by: viewer.userId!,
    outcome: state.outcome,
    discussion: input.note?.trim() || `Status set to ${state.label} from the ticket list.`,
    issue_category: lastCall?.issue_category ?? null,
    order_id: enquiry.order_id,
  });
  if (callError) return { error: `Could not move the ticket: ${callError.message}` };

  const mobile = (enquiry.students as { mobile: string } | null)?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);
  revalidatePath("/tickets");
  revalidatePath("/my-day");
  return { error: null, ok: `Moved to ${state.label}.` };
}
