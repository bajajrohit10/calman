import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The cross-badges between the two lists (§42.4).
 *
 * A lead is in exactly one bucket, which is what stops it being listed twice —
 * but the other list's reason for wanting it does not stop being true. An
 * offer lead whose follow-up also falls today is a call somebody would
 * otherwise make twice; a follow-up lead rung under a live offer three days
 * ago is a call somebody would otherwise open cold.
 *
 * The first of those is decidable from the row itself. The second is not, so
 * it is asked for the rows on screen and nothing else.
 */
export type OfferCallBadge = { offerName: string; calledOn: string };

export async function loadOfferCallBadges(
  enquiryIds: number[],
): Promise<Record<number, OfferCallBadge>> {
  if (!enquiryIds.length) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("offer_calls_for", {
    p_enquiry_ids: enquiryIds,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // A missing badge is a missing badge. It is decoration on a row that is
  // already correct, and an error here must not take the list down with it.
  if (error || !data) return {};

  const out: Record<number, OfferCallBadge> = {};
  for (const row of data as unknown as {
    enquiry_id: number;
    offer_name: string;
    called_on: string;
  }[]) {
    out[row.enquiry_id] = { offerName: row.offer_name, calledOn: row.called_on };
  }
  return out;
}
