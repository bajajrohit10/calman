import { formatDate } from "@/lib/format";

/**
 * §54.2. The shape of the working-day answer, and the pure part of it.
 *
 * Plain module, not server-only: the call panel is a client component and the
 * payload type reaches it. Splitting these out is the same move the accounts
 * enums needed — a client component that imports a server-only module fails at
 * build time, and a type import is too easy to turn into a value import later.
 */
export type WorkingDayInfo = {
  /**
   * The day the offsets are counted from.
   *
   * §79: today, or the day the lead was already due when that is later — a
   * counsellor working ahead should not pull the whole ladder forward with them.
   */
  from: string;
  /** "1" | "3" | "7" → the date N working days from `from`. */
  offsets: Record<string, string>;
  nextWorkingDay: string | null;
  /** Only the dates that are closed, and why. */
  closed: Record<string, { reason: "sunday" | "holiday"; name: string | null }>;
  /** §79: what the lead was already due, when anything was. */
  scheduled?: string | null;
  /** §79: true when `from` is the scheduled day rather than today. */
  calledEarly?: boolean;
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

/**
 * §79. "Called early — counted from 3 Oct", or nothing.
 *
 * Said because the dates on offer are otherwise inexplicable: a counsellor
 * ringing on the 2nd a lead due the 3rd is shown the 5th, and without a line
 * saying why that looks like the picker having lost a day.
 */
export function earlyLabel(
  calendar: WorkingDayInfo | null | undefined,
): string | null {
  if (!calendar?.calledEarly || !calendar.scheduled) return null;
  return `Called early — counted from ${formatDate(calendar.scheduled)}`;
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
