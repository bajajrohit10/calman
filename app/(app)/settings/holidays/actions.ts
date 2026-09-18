"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type HolidayResult = { error: string | null };

/**
 * §54.2(b). Add a closed day, or a Sunday the team is working.
 *
 * One action for both because they are one row: a date, and which way it goes
 * against the weekly rule. A working Sunday needs no name — "we are open" is
 * the whole of it — which is why the name constraint lets that one case
 * through empty.
 */
export async function addHoliday(input: {
  date: string;
  name: string;
  isWorkingOverride: boolean;
}): Promise<HolidayResult> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can change the calendar." };
  }

  const date = input.date?.trim();
  if (!date) return { error: "Pick a date." };
  const name = input.name?.trim() ?? "";
  if (!input.isWorkingOverride && !name) {
    return { error: "A holiday needs a name." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("holidays").upsert(
    {
      date,
      name: input.isWorkingOverride ? (name || null) : name,
      is_working_override: input.isWorkingOverride,
      is_active: true,
    },
    { onConflict: "date" },
  );
  if (error) return { error: error.message };

  revalidatePath("/settings/holidays");
  revalidatePath("/my-day");
  return { error: null };
}

/** Flip a row between "closed" and "working", without retyping the date. */
export async function setHolidayWorking(input: {
  date: string;
  working: boolean;
}): Promise<HolidayResult> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can change the calendar." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("holidays")
    .update({ is_working_override: input.working })
    .eq("date", input.date);
  if (error) return { error: error.message };

  revalidatePath("/settings/holidays");
  revalidatePath("/my-day");
  return { error: null };
}

export async function deleteHoliday(date: string): Promise<HolidayResult> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can change the calendar." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("holidays").delete().eq("date", date);
  if (error) return { error: error.message };

  revalidatePath("/settings/holidays");
  revalidatePath("/my-day");
  return { error: null };
}
