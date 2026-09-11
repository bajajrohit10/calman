/**
 * Dates, always in IST.
 *
 * The whole product runs on one clock (§4 "IST"), and these render on the
 * server and again in the browser, so the timezone is pinned explicitly rather
 * than inherited from wherever the code happens to be running — otherwise the
 * two disagree and React reports a hydration mismatch.
 */

const IST = "Asia/Kolkata";

/** "15 Sep 2026" from a plain `date` column. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // A bare yyyy-mm-dd is parsed as UTC midnight; render it as the calendar day
  // it is, not as the IST instant that midnight lands in.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: IST,
  }).format(new Date(iso));
}

/** "15 Sep 2026, 4:20 pm" from a timestamptz. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: IST,
  }).format(new Date(value));
}

/** "4:20 pm" from a timestamptz — for times the reader already knows the day of. */
export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: IST,
  }).format(new Date(value));
}

/** Today in IST as yyyy-mm-dd, for date input defaults and min values. */
export function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
}

/** The IST calendar day a timestamp falls on, as yyyy-mm-dd. */
export function istDateOf(value: string | null | undefined): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date(value));
}

/** yyyy-mm-dd `days` after today in IST. */
export function istDatePlus(days: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(now);
}

/** The next Monday strictly after today, in IST. */
export function istNextMonday(): string {
  const parts = istToday().split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  // getUTCDay: 0 Sun … 1 Mon. Always move forward at least one day.
  const delta = ((1 - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * The Monday of the current IST week. Reports open on "this week", and a week
 * that starts on Monday matches how the team talks about one — Sunday belongs
 * to the week that is ending, not the one about to start.
 */
export function istWeekStart(): string {
  const parts = istToday().split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
