import "server-only";

import { timed } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

/**
 * Everybody a ticket can be escalated to (§45.3).
 *
 * Separate from the counsellor rosters the screens already load, because it
 * answers a different question and had been quietly borrowing the answer to
 * theirs. Two things were wrong with that:
 *
 *   * My Day loaded its roster only for admins — the picker is on every
 *     counsellor's ticket rows, and for them the list was simply empty.
 *   * The rosters exclude the ticket team, because they exist to say "whose
 *     day am I looking at" and the ticket team does not have one. But the
 *     ticket team is exactly who half of these escalations go to.
 *
 * So: every active profile, every role, by name. The RLS on profiles already
 * lets any staff member read them — app.is_staff() — so this needs no special
 * permission and gets none.
 */
export type Escalatee = { id: string; name: string };

export async function loadEscalatees(): Promise<Escalatee[]> {
  const supabase = await createClient();
  const { data } = await timed("escalatees", () =>
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name"),
  );

  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name ?? "(no name)" }));
}
