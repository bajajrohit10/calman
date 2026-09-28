/**
 * §62.2. Support's five statuses, in words, importable from counselling.
 *
 * Its own module because the enquiry page's badge needs them and that page must
 * not pull in app/(app)/support/filters.ts — a route-local module carrying the
 * queue's parsers. One table, two callers, no duplication.
 */
export const SUPPORT_STATUS_LABELS: Record<string, string> = {
  new: "New",
  working: "Working on it",
  escalated: "Escalated",
  future: "Future date",
  resolved: "Resolved",
};
