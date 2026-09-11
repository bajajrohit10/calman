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
