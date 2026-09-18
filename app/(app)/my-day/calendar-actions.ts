"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * §54.2(c). Answer the working-Sunday question.
 *
 * Both answers write to calendar_nudges so the banner stops; only "yes" also
 * writes the holidays override that actually opens the day. Keeping those two
 * separate is what lets an unanswered question mean "not working" without
 * pretending somebody said so.
 */
export async function answerCalendarNudge(input: {
  date: string;
  working: boolean;
}): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can answer this." };
  }

  const supabase = await createClient();

  if (input.working) {
    const { error } = await supabase.from("holidays").upsert(
      { date: input.date, name: null, is_working_override: true, is_active: true },
      { onConflict: "date" },
    );
    if (error) return { error: error.message };
  }

  const { error } = await supabase.from("calendar_nudges").upsert(
    { date: input.date, working: input.working, answered_by: viewer.userId! },
    { onConflict: "date" },
  );
  if (error) return { error: error.message };

  revalidatePath("/my-day");
  revalidatePath("/settings/holidays");
  return { error: null };
}
