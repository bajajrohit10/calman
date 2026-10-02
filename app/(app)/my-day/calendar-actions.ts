"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * §54.2(c), extended by §79. Answer a calendar question.
 *
 * Both answers write to calendar_nudges so the banner stops; only "yes" also
 * writes the holidays override that actually opens the day. Keeping those two
 * separate is what lets an unanswered question mean "not working" without
 * pretending somebody said so.
 *
 * §79: `kind` says which of the two questions about a date is being answered —
 * 'planned' before it ("will the team work this?") and 'worked' after it ("they
 * did; should the calendar say so?"). They are stored separately because
 * answering one does not answer the other: 2 Oct 2026 was answered No in advance
 * and then had 125 calls logged on it, and a single row per date meant nobody
 * could ever be asked about the contradiction.
 */
export async function answerCalendarNudge(input: {
  date: string;
  working: boolean;
  kind?: "planned" | "worked";
}): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can answer this." };
  }

  const kind = input.kind === "worked" ? "worked" : "planned";
  const supabase = await createClient();

  if (input.working) {
    const { error } = await supabase.from("holidays").upsert(
      { date: input.date, name: null, is_working_override: true, is_active: true },
      { onConflict: "date" },
    );
    if (error) return { error: error.message };
  }

  const { error } = await supabase.from("calendar_nudges").upsert(
    { date: input.date, kind, working: input.working, answered_by: viewer.userId! },
    { onConflict: "date,kind" },
  );
  if (error) return { error: error.message };

  revalidatePath("/my-day");
  revalidatePath("/settings/holidays");
  return { error: null };
}
