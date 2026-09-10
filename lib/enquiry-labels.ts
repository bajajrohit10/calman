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

export function statusTone(status: EnquiryStatus): "ok" | "danger" | "neutral" | "info" | "accent" {
  if (status === "won") return "ok";
  if (status === "lost") return "danger";
  if (status === "escalated") return "accent";
  if (status === "closed") return "neutral";
  return "info";
}
