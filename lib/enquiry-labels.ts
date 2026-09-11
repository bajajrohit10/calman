/**
 * Display labels for the enquiry/call enums (§3).
 *
 * Client-safe, like lib/roles.ts: these are read inside client components as
 * well as on the server, so nothing here may import "server-only".
 */

import type { Database } from "@/types/database";

type Enums = Database["public"]["Enums"];

export type EnquiryType = Enums["enquiry_type"];
export type EnquiryStatus = Enums["enquiry_status"];
export type CallOutcome = Enums["call_outcome"];
export type ItemStatus = Enums["item_status"];
export type Importance = Enums["importance"];
export type LeadVerification = Enums["lead_verification"];
export type LostReason = Enums["lost_reason"];
export type CloseReason = Enums["close_reason"];
export type IssueCategory = Enums["issue_category"];
export type AssignmentBucket = Enums["assignment_bucket"];

export const ENQUIRY_TYPE_LABELS: Record<EnquiryType, string> = {
  purchase: "Purchase",
  after_sale: "After Sale",
};

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  open: "Open",
  won: "Won",
  lost: "Lost",
  closed: "Closed",
  escalated: "Escalated",
};

/** §3: A is "Yes + PLI"; PLI is derived from importance = A, not stored. */
export const IMPORTANCE_LABELS: Record<Importance, string> = {
  a: "A — Yes + PLI",
  b: "B — Yes, no PLI",
  c: "C — Not sure",
  d: "D — No",
};

export const LEAD_VERIFICATION_LABELS: Record<LeadVerification, string> = {
  yes_with_proof: "Yes — with proof",
  yes_without_proof: "Yes — without proof",
  no: "No",
};

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  competitor: "went to a competitor",
  max_followups: "follow-up slots exhausted",
  dropped: "dropped",
};

export const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  wrong_number: "wrong number",
  superseded: "superseded by a newer enquiry",
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  open: "Open",
  won: "Won",
  competitor: "Competitor",
  closed: "Closed",
};

export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  video_access: "Video access",
  book_delivery: "Book delivery",
  refund: "Refund",
  wrong_course: "Wrong course",
  other: "Other",
};

export const BUCKET_LABELS: Record<AssignmentBucket, string> = {
  follow_up: "Follow-up",
  fresh: "Fresh",
  campaign: "Campaign",
  call_back: "Call back",
  offer: "Offer",
};

/** The outcome each enquiry type allows, in the order the dropdown shows them. */
export const PURCHASE_OUTCOMES = [
  "follow_up",
  "call_back",
  "purchased",
  "competitor",
  "closed",
] as const satisfies readonly CallOutcome[];

export const AFTER_SALE_OUTCOMES = [
  "noted",
  "escalated",
  "resolved",
] as const satisfies readonly CallOutcome[];

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  follow_up: "Follow up — spoke to them",
  call_back: "Call back — no pickup",
  purchased: "Purchased",
  competitor: "Went to a competitor",
  closed: "Wrong number",
  noted: "Noted — working on it",
  escalated: "Escalated to the ticket team",
  resolved: "Resolved",
};

/** Short form for the history timeline, where the note carries the detail. */
export const OUTCOME_SHORT: Record<CallOutcome, string> = {
  follow_up: "Follow up",
  call_back: "Call back",
  purchased: "Purchased",
  competitor: "Competitor",
  closed: "Wrong number",
  noted: "Noted",
  escalated: "Escalated",
  resolved: "Resolved",
};

export function outcomesFor(type: EnquiryType): readonly CallOutcome[] {
  return type === "purchase" ? PURCHASE_OUTCOMES : AFTER_SALE_OUTCOMES;
}

/** Only these two carry the enquiry forward, so only they take a date (§4). */
export function outcomeTakesDate(outcome: CallOutcome | ""): boolean {
  return outcome === "follow_up" || outcome === "call_back" || outcome === "noted";
}

/**
 * The pill colour for a call's outcome, so a column of them reads as a shape
 * rather than as words: green closed the sale, red lost it, amber is waiting
 * on the student, blue is still in play.
 */
export function outcomeTone(
  outcome: CallOutcome,
): "ok" | "danger" | "neutral" | "info" | "accent" | "warn" {
  if (outcome === "purchased" || outcome === "resolved") return "ok";
  if (outcome === "competitor") return "danger";
  if (outcome === "closed") return "neutral";
  if (outcome === "call_back") return "warn";
  if (outcome === "escalated") return "accent";
  return "info";
}

export function statusTone(status: EnquiryStatus): "ok" | "danger" | "neutral" | "info" | "accent" {
  if (status === "won") return "ok";
  if (status === "lost") return "danger";
  if (status === "escalated") return "accent";
  if (status === "closed") return "neutral";
  return "info";
}

/**
 * §13.1: where an enquiry has got to, derived from the two columns
 * app.recompute_enquiry() maintains. Ordered as a lead progresses, not by
 * count — the facet re-sorts by count anyway and this is the fallback order.
 */
export const STAGE_FILTER_LABELS = {
  uncalled: "Not yet called",
  // The fresh call splits (Brief 17). "Fresh done, no follow-up" could not tell
  // a lead that was spoken to from one that never picked up, and those are two
  // different piles of work: the second is the evening call-back list.
  fresh_follow_up: "Fresh – Follow-up",
  fresh_call_back: "Fresh – Call back",
  fu1: "1st follow-up",
  fu2: "2nd",
  fu3: "3rd",
} as const;

/** The outcomes a "Last outcome" filter offers, in the order the panel lists them. */
export const LAST_OUTCOME_FILTER = [
  "follow_up",
  "call_back",
  "purchased",
  "competitor",
  "closed",
] as const;

/**
 * The facet value that means "nothing recorded for this field" (Brief 17).
 * Travels as a real option id so a multi-select can carry it alongside real
 * values; the filter parser splits it back out into its own list.
 */
export const NO_DETAIL = "__none__";

export type StageFilter = keyof typeof STAGE_FILTER_LABELS;

/**
 * The three states an offer lead can be in (§23.4).
 *
 * An offer is aimed at people who have not bought, and most of those have
 * already been given up on — so the offer views show all three by default and
 * these are how a manager takes the dead ones back out. Kept here rather than
 * in either screen because the Assignment Desk and My Day both filter on them
 * and a second copy of the mapping is how two screens start meaning different
 * things by "lost".
 */
export const OFFER_STATUS_FILTER = [
  { id: "open", name: "Open" },
  { id: "lost_exhausted", name: "Lost – exhausted" },
  { id: "lost_competitor", name: "Lost – competitor" },
  { id: "lost_dropped", name: "Lost – dropped" },
] as const;

export type OfferStatusKey = (typeof OFFER_STATUS_FILTER)[number]["id"];

/** The key for one row, from the status and reason the database returns. */
export function offerStatusOf(
  status: string,
  lostReason: string | null,
): OfferStatusKey | null {
  if (status === "open") return "open";
  if (status !== "lost") return null;
  if (lostReason === "max_followups") return "lost_exhausted";
  if (lostReason === "competitor") return "lost_competitor";
  if (lostReason === "dropped") return "lost_dropped";
  return null;
}

/** The badge for one row's offer status, or null when it is an open lead. */
export function offerStatusLabel(
  status: string,
  lostReason: string | null,
): string | null {
  const key = offerStatusOf(status, lostReason);
  if (!key || key === "open") return null;
  return OFFER_STATUS_FILTER.find((o) => o.id === key)?.name ?? null;
}
