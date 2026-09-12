import type { AssignmentBucket } from "@/lib/enquiry-labels";

/**
 * The five boxes on My Day, and the buckets behind each.
 *
 * Shared rather than declared in the screen, because the export has to mean
 * the same thing by "New Calls" that the tab does. It carries no "server-only"
 * marker on purpose: the client renders these and the export action re-derives
 * from them, and a second copy of the mapping is exactly how an export starts
 * quietly disagreeing with the screen it came from.
 */
export type MyDayTabKey = "new" | "offer" | "assigned" | "custom" | "tickets";

export const MY_DAY_TABS: {
  key: MyDayTabKey;
  label: string;
  /** Empty for Tickets, which is not assignment-backed at all. */
  buckets: AssignmentBucket[];
}[] = [
  { key: "new", label: "New Calls", buckets: ["fresh"] },
  { key: "offer", label: "Offer Calls", buckets: ["offer"] },
  { key: "assigned", label: "Assigned Calls", buckets: ["follow_up", "call_back"] },
  { key: "custom", label: "Customised", buckets: ["campaign"] },
  { key: "tickets", label: "Tickets", buckets: [] },
];

export type MyDayView = "pending" | "done";

/** For the export filename: "new-calls", "assigned-calls". */
export function myDayTabSlug(key: MyDayTabKey): string {
  const tab = MY_DAY_TABS.find((t) => t.key === key);
  return (tab?.label ?? key).toLowerCase().replace(/\s+/g, "-");
}

/**
 * The sub-tab within a My Day tab (§24).
 *
 * Three shapes rather than one string, because the three answer different
 * questions: how far down the follow-up ladder a lead is, which offer put it
 * on the list, and "show me everything". Shared with the export for the same
 * reason MY_DAY_TABS is — the export has to mean by "2/3" exactly what the
 * screen means, and a second copy of the filter is how the two start to
 * disagree.
 */
export type MyDaySubTab =
  | { kind: "all" }
  | { kind: "slot"; slot: number }
  | { kind: "offer"; offerId: string };

export const ALL_SUB_TAB: MyDaySubTab = { kind: "all" };

/** §4.3 caps a lead at three slots, so the ladder has four rungs. */
export const SLOT_SUB_TABS = [0, 1, 2, 3] as const;

/** Which tabs carry slot sub-tabs: the ones whose leads climb the ladder. */
export const SLOT_TABS: MyDayTabKey[] = ["assigned", "custom"];

/** Round-trips through a query string and a server action argument. */
export function formatSubTab(sub: MyDaySubTab): string {
  if (sub.kind === "slot") return `slot:${sub.slot}`;
  if (sub.kind === "offer") return `offer:${sub.offerId}`;
  return "all";
}

export function parseSubTab(value: string | null | undefined): MyDaySubTab {
  if (!value || value === "all") return ALL_SUB_TAB;
  if (value.startsWith("slot:")) {
    const slot = Number(value.slice(5));
    return Number.isInteger(slot) && slot >= 0 && slot <= 3
      ? { kind: "slot", slot }
      : ALL_SUB_TAB;
  }
  if (value.startsWith("offer:")) {
    const offerId = value.slice(6);
    return offerId ? { kind: "offer", offerId } : ALL_SUB_TAB;
  }
  return ALL_SUB_TAB;
}

/**
 * Does this row belong under that sub-tab?
 *
 * A lead in two offers matches both offer sub-tabs and is still one row under
 * All — which is the point of filtering rather than partitioning: All counts
 * leads, the offer tabs count leads *per offer*, and the two do not have to
 * add up.
 */
export function matchesSubTab(
  row: { slots_at_open: number; offer_ids: string[] | null },
  sub: MyDaySubTab,
): boolean {
  if (sub.kind === "all") return true;
  // slots_at_open, not follow_up_slots_used: the rung is where the lead stood
  // when the day started, so calling it moves the row from Pending to Done
  // rather than out from under the counsellor working that rung (§24.1).
  if (sub.kind === "slot") return Number(row.slots_at_open ?? 0) === sub.slot;
  return (row.offer_ids ?? []).includes(sub.offerId);
}

/** For the export filename: "assigned-calls-slot-2", "offer-calls-diwali". */
export function subTabSlug(sub: MyDaySubTab, offerName?: string | null): string {
  if (sub.kind === "slot") return `slot-${sub.slot}`;
  if (sub.kind === "offer") {
    const stem = (offerName ?? "offer").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return stem.replace(/^-|-$/g, "") || "offer";
  }
  return "";
}
