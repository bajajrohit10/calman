import { istMonthStart, istToday, istWeekStart, shiftDay } from "@/lib/format";

/**
 * The Enquiries screen's created-date window (§50.1).
 *
 * That screen answers a different question from the other two lists. New Calls
 * and the desk are work queues — everything open, oldest first, worked top to
 * bottom. Enquiries is where somebody goes to look something up, and what they
 * are nearly always looking up is what came in today. So it opens on today,
 * newest first, and the older windows are one click away.
 *
 * This is the one place Brief 48's oldest-first rule is overridden, and only
 * here: the two queues still read oldest first, because they are still queues.
 */
export const ENQUIRY_RANGES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "all", label: "All" },
] as const;

export type EnquiryRangeId = (typeof ENQUIRY_RANGES)[number]["id"] | "custom";

export function isEnquiryRange(v: string | null | undefined): v is EnquiryRangeId {
  return v === "custom" || ENQUIRY_RANGES.some((r) => r.id === v);
}

/**
 * The two dates a range resolves to — both null for "all", which is what
 * removes the restriction rather than widening it to some arbitrary span.
 */
export function rangeDates(range: EnquiryRangeId): {
  from: string | null;
  to: string | null;
} {
  const today = istToday();
  switch (range) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = shiftDay(today, -1);
      return { from: y, to: y };
    }
    case "week":
      return { from: istWeekStart(), to: today };
    case "month":
      return { from: istMonthStart(), to: today };
    // "all" and "custom" both mean "this function does not decide" — custom
    // because the caller has real dates, all because there are none.
    default:
      return { from: null, to: null };
  }
}

/**
 * What the header count calls the window it is counting.
 *
 * "42 enquiries today" reads as a fact about the day; "42 enquiries" reads as
 * a fact about the business, and on a screen that silently defaults to one day
 * that would be a lie of omission.
 */
export function rangeCountLabel(range: EnquiryRangeId, total: number): string {
  const noun = `${total} enquir${total === 1 ? "y" : "ies"}`;
  switch (range) {
    case "today":
      return `${noun} today`;
    case "yesterday":
      return `${noun} yesterday`;
    case "week":
      return `${noun} this week`;
    case "month":
      return `${noun} this month`;
    case "all":
      return `${noun} (all)`;
    default:
      return noun;
  }
}
