import "server-only";

import { istToday } from "@/lib/format";
import type { MyDayTabKey } from "@/lib/my-day-tabs";
import { createClient } from "@/lib/supabase/server";

/**
 * The team's day (§30.4): one row per active counsellor, one pair per My Day
 * category.
 *
 * Keyed on the same tab names the counsellor's own screen uses, so a cell can
 * link straight at the tab it counts and the two can never mean different
 * things by "Assigned Calls". The arithmetic is all in my_day_team(), which
 * uses the pending test my_day_pending_count already established — an
 * assignment with no call since it was handed over.
 */
export type TeamCell = { pending: number; total: number };

export type TeamRow = {
  counsellorId: string;
  counsellorName: string;
  cells: Record<MyDayTabKey, TeamCell>;
  total: TeamCell;
};

export type TeamDay = {
  rows: TeamRow[];
  /** The shared ticket queue, which is the same pair on every row. */
  tickets: TeamCell;
  error: string | null;
};

type Raw = {
  counsellor_id: string;
  counsellor_name: string;
  new_pending: number;
  new_total: number;
  offer_pending: number;
  offer_total: number;
  assigned_pending: number;
  assigned_total: number;
  custom_pending: number;
  custom_total: number;
  tickets_pending: number;
  tickets_total: number;
  total_pending: number;
  total_total: number;
};

export async function loadTeamDay(date: string): Promise<TeamDay> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_day_team", {
    p_date: date || istToday(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) {
    return { rows: [], tickets: { pending: 0, total: 0 }, error: error.message };
  }

  const raw = (data ?? []) as unknown as Raw[];
  return {
    rows: raw.map((r) => ({
      counsellorId: r.counsellor_id,
      counsellorName: r.counsellor_name,
      cells: {
        new: { pending: r.new_pending, total: r.new_total },
        offer: { pending: r.offer_pending, total: r.offer_total },
        assigned: { pending: r.assigned_pending, total: r.assigned_total },
        custom: { pending: r.custom_pending, total: r.custom_total },
        tickets: { pending: r.tickets_pending, total: r.tickets_total },
      },
      total: { pending: r.total_pending, total: r.total_total },
    })),
    tickets: raw.length
      ? { pending: raw[0].tickets_pending, total: raw[0].tickets_total }
      : { pending: 0, total: 0 },
    error: null,
  };
}
