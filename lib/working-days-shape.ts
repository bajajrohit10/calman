/**
 * §54.2. The shape of the working-day answer, and the pure part of it.
 *
 * Plain module, not server-only: the call panel is a client component and the
 * payload type reaches it. Splitting these out is the same move the accounts
 * enums needed — a client component that imports a server-only module fails at
 * build time, and a type import is too easy to turn into a value import later.
 */
export type WorkingDayInfo = {
  from: string;
  /** "1" | "3" | "7" → the date N working days from `from`. */
  offsets: Record<string, string>;
  nextWorkingDay: string | null;
  /** Only the dates that are closed, and why. */
  closed: Record<string, { reason: "sunday" | "holiday"; name: string | null }>;
};

/**
 * The next N calendar days, for asking the database which of them are closed.
 * The picker labels a date the counsellor might type, so the window has to
 * cover the ones they plausibly would.
 */
export function upcomingDates(from: string, days: number): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i <= days; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** "Sunday" or "Holiday: Diwali" — what to say under a date that is shut. */
export function closedLabel(
  date: string,
  calendar: WorkingDayInfo | null | undefined,
): string | null {
  const shut = calendar?.closed?.[date];
  if (!shut) return null;
  if (shut.reason === "sunday") return "Sunday";
  return shut.name ? `Holiday: ${shut.name}` : "Holiday";
}
