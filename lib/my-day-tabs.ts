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
/**
 * §65.2. "tickets" is gone from the union as well as from the list.
 *
 * §62.2 withdrew the tab — after-sale work is raised as a support ticket and
 * worked in Support, so a tab reading counselling's after-sale enquiries looked
 * at a pipeline nothing new enters — but left its rendering in my-day.tsx,
 * unreachable, and the key in this union to keep that code compiling. The
 * rendering is now deleted, along with the two round trips per render that were
 * fetching lists for a tab nobody could open, so the key goes too:
 * `?tab=tickets` was already falling back to New and now cannot even be named.
 */
export type MyDayTabKey = "new" | "offer" | "assigned" | "custom";

export const MY_DAY_TABS: {
  key: MyDayTabKey;
  label: string;
  buckets: AssignmentBucket[];
}[] = [
  { key: "new", label: "New Calls", buckets: ["fresh"] },
  { key: "offer", label: "Offer Calls", buckets: ["offer"] },
  { key: "assigned", label: "Assigned Calls", buckets: ["follow_up", "call_back"] },
  { key: "custom", label: "Customised", buckets: ["campaign"] },
];

export type MyDayView = "pending" | "done";

/**
 * The counsellor picker's value for the team grid (§30.4).
 *
 * A constant because two headers offer it — the one over a counsellor's own
 * day and the one over the grid — and they have to agree about the word or the
 * option navigates nowhere. That is not hypothetical: the option existed only
 * on the grid's own header at first, so the only way to reach the grid was to
 * type the query string, which nobody would.
 */
export const ALL_COUNSELLORS = "all";
export const ALL_COUNSELLORS_LABEL = "All counsellors";

/**
 * The tab named in a query string, or New Calls.
 *
 * §30.4 made a cell of the team grid a link, and a link has to be able to say
 * which tab it means. Parsed rather than cast: the string comes from a URL.
 */
export function parseMyDayTab(value: string | null | undefined): MyDayTabKey {
  const found = MY_DAY_TABS.find((t) => t.key === value);
  return found ? found.key : "new";
}

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
  | { kind: "offer"; offerId: string }
  /**
   * §80.3. Which door the lead came in by.
   *
   * Note the word "fresh" does double duty and the two meanings are unrelated:
   * the *bucket* `fresh` is "handed out as a fresh call", which is what the New
   * Calls tab is; this origin `fresh` is "not from the abandoned-checkout
   * import". The labels are the team's own words, so they stay.
   */
  | { kind: "origin"; origin: "ac" | "fresh" };

export const ALL_SUB_TAB: MyDaySubTab = { kind: "all" };

/** §4.3 caps a lead at three slots, so the ladder has four rungs. */
export const SLOT_SUB_TABS = [0, 1, 2, 3] as const;

/** Which tabs carry slot sub-tabs: the ones whose leads climb the ladder. */
export const SLOT_TABS: MyDayTabKey[] = ["assigned", "custom"];

/**
 * §80.3. The source the abandoned-checkout import files its leads under.
 *
 * Compared case-insensitively because that is how the import itself finds the
 * row — `ilike("name", "AC")` in the import action — and a rule that matched
 * more strictly here than there would split the pile it is meant to name.
 */
export const AC_SOURCE_NAME = "ac";

export const ORIGIN_SUB_TABS = ["ac", "fresh"] as const;

/** Which tabs carry origin sub-tabs: only the one that mixes the two piles. */
export const ORIGIN_TABS: MyDayTabKey[] = ["new"];

export const ORIGIN_LABELS: Record<(typeof ORIGIN_SUB_TABS)[number], string> = {
  ac: "AC",
  fresh: "Fresh",
};

/** Round-trips through a query string and a server action argument. */
export function formatSubTab(sub: MyDaySubTab): string {
  if (sub.kind === "slot") return `slot:${sub.slot}`;
  if (sub.kind === "offer") return `offer:${sub.offerId}`;
  if (sub.kind === "origin") return `origin:${sub.origin}`;
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
  if (value.startsWith("origin:")) {
    const origin = value.slice(7);
    return origin === "ac" || origin === "fresh"
      ? { kind: "origin", origin }
      : ALL_SUB_TAB;
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
  row: {
    slots_at_open: number;
    offer_ids: string[] | null;
    source_name?: string | null;
  },
  sub: MyDaySubTab,
): boolean {
  if (sub.kind === "all") return true;
  /**
   * §80.3. AC is a positive test and Fresh is its complement, so the two always
   * partition the tab and cannot both miss a row — including a lead with no
   * source recorded at all, which is Fresh because it did not come from the
   * import.
   */
  if (sub.kind === "origin") {
    const isAc = (row.source_name ?? "").trim().toLowerCase() === AC_SOURCE_NAME;
    return sub.origin === "ac" ? isAc : !isAc;
  }
  // slots_at_open, not follow_up_slots_used: the rung is where the lead stood
  // when the day started, so calling it moves the row from Pending to Done
  // rather than out from under the counsellor working that rung (§24.1).
  if (sub.kind === "slot") return Number(row.slots_at_open ?? 0) === sub.slot;
  return (row.offer_ids ?? []).includes(sub.offerId);
}

/** For the export filename: "assigned-calls-slot-2", "offer-calls-diwali". */
export function subTabSlug(sub: MyDaySubTab, offerName?: string | null): string {
  if (sub.kind === "slot") return `slot-${sub.slot}`;
  if (sub.kind === "origin") return sub.origin;
  if (sub.kind === "offer") {
    const stem = (offerName ?? "offer").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return stem.replace(/^-|-$/g, "") || "offer";
  }
  return "";
}
