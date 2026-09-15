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
  working: "Working on it",
  won: "Won",
  lost: "Lost",
  closed: "Closed",
  escalated: "Escalated",
  pending_institute: "Pending with Institute",
};

/**
 * §44.2. The five states a ticket moves through, in the order it moves
 * through them.
 *
 * "Closed" is the word a purchase enquiry uses for a wrong number, so a
 * ticket's end state says Resolved instead — the same row, told to the person
 * who cares which it is.
 */
export const TICKET_STATES = [
  { id: "open", label: "Open", outcome: "noted" },
  { id: "working", label: "Working on it", outcome: "working" },
  { id: "escalated", label: "Escalated", outcome: "escalated" },
  { id: "pending_institute", label: "Pending with Institute", outcome: "pending_institute" },
  { id: "closed", label: "Resolved", outcome: "resolved" },
] as const satisfies readonly {
  id: EnquiryStatus;
  label: string;
  outcome: CallOutcome;
}[];

export type TicketState = (typeof TICKET_STATES)[number]["id"];

/** What a ticket's status is called on a ticket screen. */
export function ticketStateLabel(status: EnquiryStatus): string {
  return TICKET_STATES.find((t) => t.id === status)?.label
    ?? ENQUIRY_STATUS_LABELS[status];
}

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
  not_interested: "not interested",
};

export const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  wrong_number: "wrong number",
  superseded: "superseded by a newer enquiry",
  converted: "converted to an after-sale enquiry",
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
  // §47.3. Below the two that lose the lead to somebody else, above the one
  // that says the number was never a lead at all.
  "not_interested",
  "closed",
] as const satisfies readonly CallOutcome[];

/** §44.2: one outcome per state, in the order the states run. */
export const AFTER_SALE_OUTCOMES = [
  "noted",
  "working",
  "escalated",
  "pending_institute",
  "resolved",
] as const satisfies readonly CallOutcome[];

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  follow_up: "Follow up — spoke to them",
  call_back: "Call back — no pickup",
  purchased: "Purchased",
  competitor: "Went to a competitor",
  not_interested: "Not interested — don't call",
  closed: "Wrong number",
  noted: "Ticket, still open",
  working: "Working on it",
  escalated: "Escalated — to somebody",
  pending_institute: "Pending with the institute",
  resolved: "Resolved",
};

/** Short form for the history timeline, where the note carries the detail. */
export const OUTCOME_SHORT: Record<CallOutcome, string> = {
  follow_up: "Follow up",
  call_back: "Call back",
  purchased: "Purchased",
  competitor: "Competitor",
  not_interested: "Not interested",
  closed: "Wrong number",
  noted: "Ticket",
  working: "Working",
  escalated: "Escalated",
  pending_institute: "With institute",
  resolved: "Resolved",
};

export function outcomesFor(type: EnquiryType): readonly CallOutcome[] {
  return type === "purchase" ? PURCHASE_OUTCOMES : AFTER_SALE_OUTCOMES;
}

/**
 * Which outcomes carry the enquiry forward, and so take a date (§4, §44.3).
 *
 * On a ticket that is every state except Resolved: a ticket that is open,
 * being worked, escalated or sitting with the institute all have a day
 * somebody should look at them again, and only the resolved one does not.
 */
export function outcomeTakesDate(outcome: CallOutcome | ""): boolean {
  return (
    outcome === "follow_up" ||
    outcome === "call_back" ||
    outcome === "noted" ||
    outcome === "working" ||
    outcome === "escalated" ||
    outcome === "pending_institute"
  );
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
  if (outcome === "competitor" || outcome === "not_interested") return "danger";
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
  "not_interested",
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
  { id: "lost_not_interested", name: "Lost – not interested" },
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
  if (lostReason === "not_interested") return "lost_not_interested";
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

/**
 * Which follow-up is due next (§45.1).
 *
 * The screens used to show the counter itself — "0/3", "2 of 3" — which is a
 * number about the past dressed as instruction. A counsellor picking up a lead
 * wants to know which call they are about to make, and "0/3" is the one
 * phrasing that does not say it: it reads as *none of three*, which is either
 * "nothing to do" or "three to do" depending on who is reading.
 *
 * So the label names the next call. The three-slot rule itself is unchanged —
 * this is what the same number is called.
 *
 * Reports keep the counter, because their columns count calls that were made;
 * the Stage filter keeps its values, because those are a filter's vocabulary
 * and renaming them would change what a saved link means.
 */
export function nextFollowUpLabel(
  slotsUsed: number | null | undefined,
  /** Null fresh_call_date means nobody has called this lead at all. */
  everCalled = true,
): string {
  if (!everCalled) return "Fresh call";
  const used = Math.max(0, slotsUsed ?? 0);
  if (used >= 3) return "Many Follow-ups";
  return ["1st Follow-up", "2nd Follow-up", "3rd Follow-up"][used];
}

/** The column header that used to say "Slots". */
export const NEXT_FOLLOW_UP_HEADER = "Next follow-up";

/**
 * The evening call-back list, split by how far down the ladder the call back
 * was (§47.4).
 *
 * One pile of "Evening call backs" was hiding three different jobs. A student
 * who did not pick up their very first call is a stranger; one who has not
 * picked up twice already is a decision about whether to keep going. The
 * counsellor working the list at six o'clock is doing different work in each
 * case, and the label they get on My Day should say which.
 *
 * Keyed by the stage the desk already derives, so this is a naming of
 * something that existed rather than a new axis: fu3 is absent because §4.3
 * loses a lead on its third missed follow-up, so there is never a fourth rung
 * to hand out. The slot rule is untouched by any of this.
 *
 * The label doubles as the campaign label stamped on the assignment, which is
 * what makes My Day group the three the same way — so these strings are what a
 * counsellor reads on both screens, and changing one changes both.
 */
export const EVENING_SUB_TABS = [
  { stage: "fresh_call_back", label: "Call back – Fresh" },
  { stage: "fu1", label: "Call back – 1st follow-up" },
  { stage: "fu2", label: "Call back – 2nd follow-up" },
] as const;

export type EveningSubTab = (typeof EVENING_SUB_TABS)[number]["stage"];

/** The campaign label for one evening sub-tab, or null if it is not one. */
export function eveningLabelFor(stages: string[]): string | null {
  if (stages.length !== 1) return null;
  return EVENING_SUB_TABS.find((t) => t.stage === stages[0])?.label ?? null;
}
