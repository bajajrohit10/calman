"use server";

import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * How many leads are waiting in the New Calls pool (§29.1).
 *
 * One head count, no rows: the pill needs the number and nothing else, and it
 * asks for it once a minute from every open tab.
 *
 * Returns null rather than throwing when nobody is signed in — a poll that
 * outlives a session should go quiet, not put an error on a page the person
 * has already left.
 */
export async function newCallsWaiting(): Promise<number | null> {
  const viewer = await getViewer();
  if (!viewer.profile) return null;

  const supabase = await createClient();
  // §33.6. Both halves of the pool. A pill that counted only purchases would
  // say nothing is waiting while somebody sits in the after-sale queue.
  const [purchase, afterSale] = await Promise.all([
    supabase.rpc("new_calls_pool", {
      p_limit: 1,
      p_offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
    supabase.rpc("new_calls_after_sale", {
      p_limit: 1,
      p_offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  ]);

  if (purchase.error) return null;
  const count = (d: unknown) =>
    Number((d as { total_count: number }[] | null)?.[0]?.total_count ?? 0);
  return count(purchase.data) + count(afterSale.data);
}
