"use server";

import { revalidatePath } from "next/cache";

import { getViewer, isAdmin } from "@/lib/auth";
import { countOfferMatches } from "@/lib/offers";
import {
  TARGET_KEYS,
  TARGET_TABLES,
  type OfferTargetKey,
  type OfferTargets,
} from "@/lib/offer-shape";
import { createClient } from "@/lib/supabase/server";

export type OfferActionResult = { error: string | null; ok?: string; id?: string };

/**
 * Five join tables, one loop. The column name is only known at run time, so
 * the generated types cannot express the row — narrowed structurally here,
 * once, the way the master-list actions do it, rather than casting at the call
 * site. The table name comes from TARGET_TABLES, never from user input.
 */
type TargetWriter = {
  delete(): { eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }> };
  insert(values: Record<string, string>[]): PromiseLike<{ error: { message: string } | null }>;
};

/**
 * Writes go through the caller's own session, so the RLS policies decide
 * whether this is allowed — a counsellor reaching this endpoint directly gets
 * a database refusal, not a silent success. The check here is the belt: a
 * server action is a public HTTP endpoint, and the fact that the page
 * redirected them away proves nothing.
 */
async function authorise() {
  const viewer = await getViewer();
  if (!viewer.userId) return { userId: null, error: "Not signed in." } as const;
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { userId: null, error: "Only an admin or manager can edit offers." } as const;
  }
  return { userId: viewer.userId, error: null } as const;
}

export type OfferInput = {
  id?: string | null;
  name: string;
  startDate: string;
  endDate: string;
  reminderDays: number;
  targets: OfferTargets;
};

function validate(input: OfferInput): string | null {
  if (!input.name.trim()) return "Give the offer a name.";
  if (!input.startDate || !input.endDate) return "An offer needs both dates.";
  if (input.endDate < input.startDate) return "The end date is before the start date.";
  if (!Number.isFinite(input.reminderDays) || input.reminderDays < 0) {
    return "Reminder days must be zero or more.";
  }
  if (input.reminderDays > 365) return "Reminder days must be 365 or fewer.";
  return null;
}

/**
 * Create or update an offer and its five target lists.
 *
 * The targets are replaced wholesale — delete then insert — rather than
 * diffed. A diff would be three statements' worth of cleverness to save
 * nothing: the lists are tens of rows, the join tables have no other columns
 * to preserve, and a diff that gets an edge case wrong leaves an offer
 * silently aimed at something nobody chose.
 */
export async function saveOffer(input: OfferInput): Promise<OfferActionResult> {
  const auth = await authorise();
  if (auth.error) return { error: auth.error };

  const problem = validate(input);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const row = {
    name: input.name.trim(),
    start_date: input.startDate,
    end_date: input.endDate,
    reminder_days: input.reminderDays,
  };

  let id = input.id ?? null;
  if (id) {
    const { error } = await supabase.from("offers").update(row).eq("id", id);
    if (error) return { error: `Could not save the offer: ${error.message}` };
  } else {
    const { data, error } = await supabase
      .from("offers")
      .insert({ ...row, created_by: auth.userId! })
      .select("id")
      .single();
    if (error) return { error: `Could not create the offer: ${error.message}` };
    id = data.id;
  }

  for (const key of TARGET_KEYS) {
    const spec = TARGET_TABLES[key];
    const target = supabase.from(spec.table) as unknown as TargetWriter;
    const { error: wipe } = await target.delete().eq("offer_id", id);
    if (wipe) return { error: `Could not clear ${spec.label}: ${wipe.message}` };

    const values = [...new Set(input.targets[key] ?? [])];
    if (!values.length) continue;
    const { error: add } = await target.insert(
      values.map((v) => ({ offer_id: id as string, [spec.column]: v })),
    );
    if (add) return { error: `Could not save ${spec.label}: ${add.message}` };
  }

  revalidatePath("/settings/offers");
  revalidatePath("/assign");
  revalidatePath("/my-day");
  return { error: null, ok: input.id ? "Offer saved." : "Offer created.", id };
}

/**
 * Soft-delete, like every other master list (§3): an offer that has stopped
 * running still has to explain the assignments it caused, so nothing is ever
 * removed — it stops matching.
 */
export async function setOfferActive(
  id: string,
  active: boolean,
): Promise<OfferActionResult> {
  const auth = await authorise();
  if (auth.error) return { error: auth.error };

  const supabase = await createClient();
  const { error } = await supabase.from("offers").update({ is_active: active }).eq("id", id);
  if (error) return { error: `Could not change the offer: ${error.message}` };

  revalidatePath("/settings/offers");
  revalidatePath("/assign");
  revalidatePath("/my-day");
  return { error: null, ok: active ? "Offer reactivated." : "Offer deactivated." };
}

/**
 * "Matches N open leads today", for the form.
 *
 * Live rather than on save: a wrong target is only obvious while you can still
 * see what it did, and the alternative is finding out on the morning a
 * counsellor is handed four thousand leads.
 */
export async function previewOfferMatches(
  targets: Record<OfferTargetKey, string[]>,
): Promise<{ count: number; error: string | null }> {
  const auth = await authorise();
  if (auth.error) return { count: 0, error: auth.error };
  return countOfferMatches(targets);
}
