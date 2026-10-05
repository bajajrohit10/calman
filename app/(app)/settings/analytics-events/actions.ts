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
  at: string;
  note: string;
}): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can add an event." };
  }
  const note = input.note.trim();
  if (!note) return { error: "Say what changed." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.at)) return { error: "Pick a date." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("analytics_events")
    .insert({ at: input.at, note, created_by: viewer.userId! });
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
