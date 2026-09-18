import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { WorkingDayInfo } from "@/lib/working-days-shape";

export type { WorkingDayInfo };
export { upcomingDates, closedLabel } from "@/lib/working-days-shape";

const EMPTY: WorkingDayInfo = {
  from: "",
  offsets: {},
  nextWorkingDay: null,
  closed: {},
};

/**
 * §54.2. What the follow-up picker needs to know about the calendar.
 *
 * The arithmetic lives in the database because two things have to agree about
 * it — the chips a counsellor clicks and the trigger that snaps the saved date
 * — and a second implementation in TypeScript is how those two would come to
 * disagree about a Sunday the team decided to work.
 */
export async function loadWorkingDays(
  from: string | null,
  offsets: number[],
  dates: string[],
): Promise<WorkingDayInfo> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("working_day_info", {
    p_from: from,
    p_offsets: offsets,
    p_dates: dates.length ? dates : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  if (error || !data) return EMPTY;
  return data as unknown as WorkingDayInfo;
}
