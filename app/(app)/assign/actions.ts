"use server";

import { revalidatePath } from "next/cache";

import { getViewer, isAdmin } from "@/lib/auth";
import type { AssignmentBucket } from "@/lib/enquiry-labels";
import { createClient } from "@/lib/supabase/server";

export type AssignResult = { error: string | null; ok?: string };

/**
 * The desk is admin/manager only, and so are the assignment RLS policies. This
 * is checked here as well because a server action is a public HTTP endpoint —
 * the fact that the page redirected a counsellor away proves nothing.
 */
async function authorise() {
  const viewer = await getViewer();
  if (!viewer.userId) return { userId: null, error: "Not signed in." } as const;
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { userId: null, error: "Only an admin or manager can assign work." } as const;
  }
  return { userId: viewer.userId, error: null } as const;
}

/**
 * Assign enquiries to one counsellor for one date (§5.5).
 *
 * §10 decision 9 puts a unique constraint on (enquiry_id, date): one owner per
 * enquiry per day. Reassignment is therefore an upsert on that key rather than
 * a delete-then-insert, so moving a row never leaves it briefly unowned.
 */
export async function assignEnquiries(input: {
  /**
   * Each row carries the bucket it was derived into by §6, so a fresh lead
   * lands in My Day under Fresh and a call back under Call back. A blanket
   * bucket would file the whole selection under one heading and quietly lose
   * the ordering the recommended list just worked out. Campaign mode is the
   * one exception, and the caller passes 'campaign' for every row.
   */
  rows: { enquiryId: number; bucket: AssignmentBucket }[];
  counsellorId: string;
  date: string;
}): Promise<AssignResult> {
  const auth = await authorise();
  if (auth.error) return { error: auth.error };

  if (!input.rows.length) return { error: "Nothing selected." };
  if (!input.counsellorId) return { error: "Choose a counsellor." };
  if (!input.date) return { error: "Choose a date." };

  const supabase = await createClient();
  const rows = input.rows.map((r) => ({
    enquiry_id: r.enquiryId,
    date: input.date,
    counsellor_id: input.counsellorId,
    bucket: r.bucket,
    assigned_by: auth.userId!,
  }));

  const { error } = await supabase
    .from("assignments")
    .upsert(rows, { onConflict: "enquiry_id,date" });

  if (error) return { error: `Could not assign: ${error.message}` };

  revalidatePath("/assign");
  revalidatePath("/my-day");
  return {
    error: null,
    ok: `Assigned ${rows.length} enquir${rows.length === 1 ? "y" : "ies"}.`,
  };
}

/** Admin may take work off the board entirely (§5.5). */
export async function unassignEnquiries(input: {
  enquiryIds: number[];
  date: string;
}): Promise<AssignResult> {
  const auth = await authorise();
  if (auth.error) return { error: auth.error };
  if (!input.enquiryIds.length) return { error: "Nothing selected." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("assignments")
    .delete()
    .eq("date", input.date)
    .in("enquiry_id", input.enquiryIds);

  if (error) return { error: `Could not unassign: ${error.message}` };

  revalidatePath("/assign");
  revalidatePath("/my-day");
  return { error: null, ok: `Unassigned ${input.enquiryIds.length}.` };
}

/**
 * Leave cover (§5.5): move one counsellor's entire day to another in one
 * action. Scoped to the date and the source counsellor, so it cannot touch
 * anyone else's rows — the thing worth being careful about here.
 */
export async function reassignDay(input: {
  fromCounsellorId: string;
  toCounsellorId: string;
  date: string;
}): Promise<AssignResult> {
  const auth = await authorise();
  if (auth.error) return { error: auth.error };

  if (!input.fromCounsellorId || !input.toCounsellorId) {
    return { error: "Choose both counsellors." };
  }
  if (input.fromCounsellorId === input.toCounsellorId) {
    return { error: "Those are the same person." };
  }

  const supabase = await createClient();

  // Counted first so the result can say how many actually moved, rather than
  // reporting success over a no-op.
  const { data: moving, error: countError } = await supabase
    .from("assignments")
    .select("id")
    .eq("date", input.date)
    .eq("counsellor_id", input.fromCounsellorId);

  if (countError) return { error: countError.message };
  if (!moving?.length) return { error: "That counsellor has nothing assigned on this date." };

  const { error } = await supabase
    .from("assignments")
    .update({ counsellor_id: input.toCounsellorId, assigned_by: auth.userId! })
    .eq("date", input.date)
    .eq("counsellor_id", input.fromCounsellorId);

  if (error) return { error: `Could not reassign: ${error.message}` };

  revalidatePath("/assign");
  revalidatePath("/my-day");
  return { error: null, ok: `Moved ${moving.length} assignment${moving.length === 1 ? "" : "s"}.` };
}

/** §5.8: an admin may dismiss the overdue report for a date. */
export async function dismissOverdue(date: string): Promise<AssignResult> {
  const auth = await authorise();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("overdue_dismissals")
    .upsert({ date, dismissed_by: auth.userId! }, { onConflict: "date" });

  if (error) return { error: `Could not dismiss: ${error.message}` };

  revalidatePath("/my-day");
  return { error: null, ok: "Dismissed for today. The items still roll forward." };
}
