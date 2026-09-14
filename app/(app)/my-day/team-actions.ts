"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import type { AssignmentBucket } from "@/lib/enquiry-labels";
import { loadMyDay } from "@/lib/my-day";
import { MY_DAY_TABS, type MyDayTabKey } from "@/lib/my-day-tabs";
import { loadTeamDay, type TeamDay } from "@/lib/my-day-team";
import { createClient } from "@/lib/supabase/server";

export type MoveResult = {
  error: string | null;
  moved?: number;
  skipped?: number;
};

/** The buckets behind a My Day tab, or null for "every category". */
function bucketsFor(tab: MyDayTabKey | "all"): AssignmentBucket[] | null {
  if (tab === "all") return null;
  const buckets = MY_DAY_TABS.find((t) => t.key === tab)?.buckets ?? [];
  return buckets.length ? buckets : null;
}

/**
 * Hand a counsellor's uncalled calls to somebody else (§30.5).
 *
 * The counting, the ordering and the permission all live in
 * reallocate_assignments: this passes the request through and turns a refusal
 * into a sentence. Who moved what is already recorded — every row it touches
 * goes through the audit trigger with the mover as the actor, and the
 * assignment itself keeps assigned_by and assigned_at.
 */
export async function moveAssignments(input: {
  date: string;
  fromId: string;
  toId: string;
  tab: MyDayTabKey | "all";
  /** null moves every pending one in that category. */
  count: number | null;
  /** When the counsellor picked rows by hand, exactly these. */
  enquiryIds: number[] | null;
  /** Defaults to the same day. */
  targetDate: string | null;
}): Promise<MoveResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!isAdmin(viewer.profile.role)) {
    return { error: "Only an admin or manager can move calls between counsellors." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reallocate_assignments", {
    p_date: input.date,
    p_from: input.fromId,
    p_to: input.toId,
    p_buckets: bucketsFor(input.tab),
    p_count: input.enquiryIds?.length ? null : input.count,
    p_enquiry_ids: input.enquiryIds?.length ? input.enquiryIds : null,
    p_target_date: input.targetDate || input.date,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };

  const row = (data as unknown as { moved: number; skipped: number }[] | null)?.[0];
  revalidatePath("/my-day");
  return { error: null, moved: row?.moved ?? 0, skipped: row?.skipped ?? 0 };
}

/**
 * Roll a day's uncalled calls onto another date, same counsellor (§30.6).
 *
 * A counsellor may do this for their own day; anybody else's is a manager's
 * call. The function enforces that, not this — but the message a counsellor
 * sees for their own mistake should not be a database error, so the obvious
 * case is answered here too.
 */
export async function carryForward(input: {
  date: string;
  counsellorId: string;
  toDate: string;
  tab: MyDayTabKey | "all";
  enquiryIds: number[] | null;
}): Promise<MoveResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!isAdmin(viewer.profile.role) && input.counsellorId !== viewer.userId) {
    return { error: "You can only carry forward your own calls." };
  }
  if (input.toDate === input.date) {
    return { error: "Choose a different date to carry forward to." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("carry_forward_assignments", {
    p_date: input.date,
    p_counsellor: input.counsellorId,
    p_to_date: input.toDate,
    p_buckets: bucketsFor(input.tab),
    p_enquiry_ids: input.enquiryIds?.length ? input.enquiryIds : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };

  const row = (data as unknown as { moved: number; skipped: number }[] | null)?.[0];
  revalidatePath("/my-day");
  return { error: null, moved: row?.moved ?? 0, skipped: row?.skipped ?? 0 };
}

/**
 * Every pending row behind one cell of the team grid, for "pick rows".
 *
 * Read through loadMyDay rather than a query of its own, so the list somebody
 * ticks is the same list that counsellor sees on their own screen — including
 * the same idea of which rows are still pending.
 */
export async function pendingForMove(input: {
  date: string;
  counsellorId: string;
  tab: MyDayTabKey | "all";
}): Promise<{
  error: string | null;
  rows?: { enquiryId: number; mobile: string; name: string | null; label: string | null }[];
}> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!isAdmin(viewer.profile.role) && input.counsellorId !== viewer.userId) {
    return { error: "You can only see your own day." };
  }

  const day = await loadMyDay({ date: input.date, counsellorId: input.counsellorId });
  if (day.error) return { error: day.error };

  const buckets = bucketsFor(input.tab);
  return {
    error: null,
    rows: day.rows
      .filter(
        (r) =>
          !r.called_today &&
          !r.carried_to &&
          (!buckets || buckets.includes(r.bucket)),
      )
      .map((r) => ({
        enquiryId: r.enquiry_id,
        mobile: r.mobile,
        name: r.student_name,
        label: r.assignment_label,
      })),
  };
}

/** Re-read the team grid after a move, without losing the page. */
export async function refreshTeamDay(date: string): Promise<TeamDay> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { rows: [], tickets: { pending: 0, total: 0 }, error: "Not allowed." };
  }
  return loadTeamDay(date);
}
