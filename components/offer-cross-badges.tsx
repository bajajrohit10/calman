import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";

/**
 * The two badges that say what the *other* list knows (§42.4).
 *
 * A lead appears once. Which bucket it lands in is decided by §6 and by the
 * offer rules, and that decision hides a fact the caller needs:
 *
 *   in the Offer list — its ordinary follow-up is also due today, so this is
 *     the one call, not the first of two;
 *   in the follow-up list — it was already rung under an offer that is still
 *     running, so the discount has been mentioned and by whom is in the notes.
 *
 * One component for both because they are one idea, and because the desk and
 * My Day drawing them differently is how two screens start disagreeing about
 * what a lead is.
 */
export function OfferCrossBadges({
  bucket,
  nextFollowUpDate,
  date,
  offerCall,
}: {
  bucket: string;
  nextFollowUpDate: string | null;
  /** The day being viewed, not today: the desk plans other days. */
  date: string;
  /** From offer_calls_for, when this lead has one. */
  offerCall?: { offerName: string; calledOn: string } | null;
}) {
  const alsoDue = bucket === "offer" && nextFollowUpDate === date;
  // Only on a row that is *not* in the offer list: on an offer row the offer's
  // own name is already there, and saying it twice reads as two offers.
  const calledUnderOffer = bucket !== "offer" && offerCall ? offerCall : null;

  if (!alsoDue && !calledUnderOffer) return null;

  return (
    <>
      {alsoDue ? <Badge tone="warn">Also due for follow-up today</Badge> : null}
      {calledUnderOffer ? (
        <Badge tone="info">
          Offer {calledUnderOffer.offerName} · called{" "}
          {formatDate(calledUnderOffer.calledOn)}
        </Badge>
      ) : null}
    </>
  );
}
