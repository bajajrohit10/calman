"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { clearMasters } from "@/lib/masters";
import { createClient } from "@/lib/supabase/server";

export type TypedNameResult = { error: string | null; moved?: number };

/**
 * §89. A typed name was a real competitor all along: list it, and re-point
 * every lead that named it.
 *
 * Both halves in one database call, because a promoted name whose leads failed
 * to follow would read as a competitor with no losses — which is worse than
 * either half not happening. The SQL function re-checks the role; this checks
 * it too so the refusal is a sentence rather than a Postgres exception.
 */
export async function promoteTypedName(input: {
  name: string;
  newName?: string;
}): Promise<TypedNameResult> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can change the competitor list." };
  }
  const name = input.name?.trim();
  if (!name) return { error: "Which typed name?" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("promote_competitor_other", {
    p_name: name,
    p_new_name: input.newName?.trim() || undefined,
  });
  if (error) return { error: error.message };

  done();
  return { error: null };
}

/** The same re-point, into a competitor that is already on the list. */
export async function mergeTypedName(input: {
  name: string;
  competitorId: string;
}): Promise<TypedNameResult> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) {
    return { error: "Only a manager or super admin can change the competitor list." };
  }
  const name = input.name?.trim();
  if (!name) return { error: "Which typed name?" };
  if (!input.competitorId) return { error: "Pick the competitor to merge it into." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_competitor_other", {
    p_name: name,
    p_competitor_id: input.competitorId,
  });
  if (error) return { error: error.message };

  done();
  return { error: null, moved: Number(data ?? 0) };
}

/**
 * Both actions change the competitor list and the leads pointing at it, so
 * both invalidate the same three things: the page itself, the cached master
 * list the call panel's picker reads, and the Enquiries list where the name
 * now shows in the Lost reason column.
 */
function done() {
  clearMasters();
  revalidatePath("/settings/competitors");
  revalidatePath("/enquiries");
  revalidatePath("/analytics");
}
