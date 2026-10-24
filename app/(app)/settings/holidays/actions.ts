"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import {
  asCalendarKind,
  kindToOverride,
  type CalendarKind,
} from "@/lib/calendar-kinds";
import { createClient } from "@/lib/supabase/server";

export type HolidayResult = { error: string | null };

/**
 * §54.2(b), named by §88. Add a closed day, or a day the team is working.
 *
 * One action for both because they are one row: a date, and which way it goes
 * against the weekly rule. A working day needs no name — "we are open" is the
 * whole of it — which is why the name constraint lets that one case through
 * empty.
 *
 * §88 takes the kind by name rather than as a boolean. The caller is a form
 * where somebody chose between two words, and "isWorkingOverride: false" is a
 * worse description of "Holiday" than "holiday" is.
 */
export async function addHoliday(input: {
  date: string;
  name: string;
  kind: CalendarKind;
}): Promise<HolidayResult> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can change the calendar." };
  }

  const kind = asCalendarKind(input.kind);
  const working = kindToOverride(kind);
  const date = input.date?.trim();
  if (!date) return { error: "Pick a date." };
  const name = input.name?.trim() ?? "";
  if (!working && !name) {
    return { error: "A holiday needs a name." };
  }

  // Upsert on the date, because a date is one decision: marking a listed
  // holiday as worked after all changes that row rather than adding a second
  // one the calendar would have to choose between.
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").upsert(
    {
      date,
      name: working ? (name || null) : name,
      is_working_override: working,
      is_active: true,
    },
    { onConflict: "date" },
  );
  if (error) return { error: error.message };

  revalidatePath("/settings/holidays");
  revalidatePath("/my-day");
  return { error: null };
}

/** Change a listed date's kind, without retyping the date. */
export async function setHolidayKind(input: {
  date: string;
  kind: CalendarKind;
}): Promise<HolidayResult> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can change the calendar." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("holidays")
    .update({ is_working_override: kindToOverride(asCalendarKind(input.kind)) })
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
