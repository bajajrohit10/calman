"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { istToday } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

import { parseNewCallsParams } from "./filters";

export type TakeResult = {
  error: string | null;
  ok?: string;
  /** Rows someone else claimed first, named so the message can say who. */
  lost?: { enquiryId: number; takenBy: string }[];
};

/**
 * Claim unassigned leads for today (§5.12).
 *
 * The (enquiry_id, date) unique constraint is the arbiter, not a prior check:
 * two counsellors pressing Take on the same row within the same second both
 * pass any "is it free?" test, and only the insert can actually settle it. So
 * this inserts and reads the failures back, which is the only version that is
 * correct under a race rather than merely usually correct.
 *
 * Rows are inserted one at a time on purpose. A single multi-row insert is one
 * statement: if any row collides the whole thing rolls back, and taking ten
 * leads would fail because a colleague took one of them.
 */
export async function takeEnquiries(enquiryIds: number[]): Promise<TakeResult> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!enquiryIds.length) return { error: "Nothing to take." };

  const supabase = await createClient();
  const date = istToday();

  const taken: number[] = [];
  const collided: number[] = [];

  for (const enquiryId of enquiryIds) {
    const { error } = await supabase.from("assignments").insert({
      enquiry_id: enquiryId,
      date,
      counsellor_id: viewer.userId!,
      bucket: "fresh",
      assigned_by: viewer.userId!,
    });

    if (!error) {
      taken.push(enquiryId);
      continue;
    }
    // 23505: someone else got there first.
    if (error.code === "23505") {
      collided.push(enquiryId);
      continue;
    }
    return { error: `Could not take that lead: ${error.message}` };
  }

  let lost: { enquiryId: number; takenBy: string }[] = [];
  if (collided.length) {
    const { data } = await supabase
      .from("assignments")
      .select("enquiry_id, counsellor:profiles!assignments_counsellor_id_fkey ( full_name )")
      .eq("date", date)
      .in("enquiry_id", collided);

    lost = (data ?? []).map((a) => ({
      enquiryId: a.enquiry_id,
      takenBy:
        (a.counsellor as { full_name: string | null } | null)?.full_name ?? "someone else",
    }));
  }

  revalidatePath("/new-calls");
  revalidatePath("/my-day");
  revalidatePath("/assign");

  if (!taken.length && lost.length) {
    const names = [...new Set(lost.map((l) => l.takenBy))].join(", ");
    return {
      error: `Already taken by ${names}.`,
      lost,
    };
  }

  return {
    error: null,
    ok:
      `Took ${taken.length} lead${taken.length === 1 ? "" : "s"}.` +
      (lost.length
        ? ` ${lost.length} had already been taken by ${[...new Set(lost.map((l) => l.takenBy))].join(", ")}.`
        : ""),
    lost,
  };
}

/**
 * Take the next N of the *current filtered set*, in the order the page shows
 * them — so "take the next 10 AC leads" means exactly that, and not the next
 * ten of everything.
 */
export async function takeNext(search: string, count: number): Promise<TakeResult> {
  await requireUser();

  const params = new URLSearchParams(search);
  const { filters } = parseNewCallsParams((k) => params.get(k));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("new_calls_pool", {
    ...filters,
    p_limit: count,
    p_offset: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };
  const ids = ((data ?? []) as { enquiry_id: number }[]).map((r) => r.enquiry_id);
  if (!ids.length) return { error: "Nothing matches the current filter." };

  return takeEnquiries(ids);
}

/** Selecting more than this at once is a mistake, not an intention. */
const MAX_SELECT = 2000;

export type SelectAllPoolResult = {
  error: string | null;
  ids?: number[];
  total?: number;
};

/**
 * Every lead the current New Calls filter matches, across all pages (§20.1).
 *
 * Takes the query string rather than a filter object for the same reason the
 * Assignment Desk does: the selection is parsed by exactly the code that
 * produced the page on screen, so "select all 240 matching" cannot quietly
 * mean a different 240.
 *
 * Paged, because the pool RPC is subject to PostgREST's row cap like anything
 * else and a short array here would be a silent under-selection.
 */
export async function selectAllPool(search: string): Promise<SelectAllPoolResult> {
  await requireUser();

  const params = new URLSearchParams(search);
  const { filters } = parseNewCallsParams((k) => params.get(k));

  const supabase = await createClient();
  const PAGE = 500;
  const ids: number[] = [];

  for (let offset = 0; offset < MAX_SELECT; offset += PAGE) {
    const { data, error } = await supabase.rpc("new_calls_pool", {
      ...filters,
      p_limit: PAGE,
      p_offset: offset,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) return { error: error.message };

    const rows = (data ?? []) as { enquiry_id: number }[];
    ids.push(...rows.map((r) => r.enquiry_id));
    if (rows.length < PAGE) return { error: null, ids, total: ids.length };
  }

  return {
    error:
      `That is more than ${MAX_SELECT} leads. Narrow the filter — taking them ` +
      `all would put a day's work on one person.`,
  };
}
