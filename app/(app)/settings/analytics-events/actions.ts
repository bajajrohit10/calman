"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * §83.3. Record or remove one analytics event.
 *
 * Both re-check the role server-side. The Settings route gates the page and the
 * table's RLS gates the write, so this is the third of three — which is the right
 * number for something that annotates everybody's numbers.
 */
export async function addAnalyticsEvent(input: {
  note: string;
  scopeType: "all" | "teacher" | "institute" | "course_subject";
  scopeId: string | null;
  startDate: string;
  /** Null means still running. */
  endDate: string | null;
  metricNote: string | null;
}): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can add an event." };
  }
  const note = input.note.trim();
  if (!note) return { error: "Say what changed." };
  const iso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!iso(input.startDate)) return { error: "Pick a start date." };
  if (input.endDate && !iso(input.endDate)) return { error: "That end date is not a date." };
  if (input.endDate && input.endDate < input.startDate) {
    return { error: "The end date is before the start." };
  }
  // A scope that names a shape must name a thing. The check constraint says the
  // same, but a message here is better than a constraint violation on screen.
  if (input.scopeType !== "all" && !input.scopeId) {
    return { error: "Pick who this applies to." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("analytics_events").insert({
    // `at` stays the day it was recorded, which for a new row is its start.
    at: input.startDate,
    note,
    scope_type: input.scopeType,
    scope_id: input.scopeType === "all" ? null : input.scopeId,
    start_date: input.startDate,
    end_date: input.endDate,
    metric_note: input.metricNote?.trim() || null,
    created_by: viewer.userId!,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings/analytics-events");
  revalidatePath("/analytics");
  return { error: null };
}

/**
 * §84.2. Close a running experiment, or reopen one.
 *
 * Its own action rather than an edit form: the only field anybody changes after the
 * fact is the end date — which is how Rohit sets 21 Oct on the row §84.2 migrated —
 * and a one-field update is a button, not a form.
 */
export async function setAnalyticsEventEnd(input: {
  id: string;
  endDate: string | null;
}): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can change an experiment." };
  }
  if (input.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    return { error: "That is not a date." };
  }

  const supabase = await createClient();
  const { data: row, error: findError } = await supabase
    .from("analytics_events")
    .select("start_date")
    .eq("id", input.id)
    .maybeSingle();
  if (findError) return { error: findError.message };
  if (!row) return { error: "That experiment no longer exists." };
  if (input.endDate && input.endDate < (row.start_date as string)) {
    return { error: "The end date is before the start." };
  }

  const { error } = await supabase
    .from("analytics_events")
    .update({ end_date: input.endDate })
    .eq("id", input.id);
  if (error) return { error: error.message };

  revalidatePath("/settings/analytics-events");
  revalidatePath("/analytics");
  return { error: null };
}

export async function deleteAnalyticsEvent(id: string): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can delete an event." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("analytics_events").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/settings/analytics-events");
  revalidatePath("/analytics");
  return { error: null };
}
