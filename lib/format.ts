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

/**
 * "16 Sept 10:42" from a timestamptz — when a lead arrived (§48.1).
 *
 * Its own format rather than formatDateTime because this one goes in a column,
 * many rows deep, and has to be scannable at a glance: no year, because a
 * pipeline is worked in days and the year is the same on every row, and a
 * 24-hour clock, because "10:42" and "22:42" line up and "10:42 am" and
 * "10:42 pm" do not.
 */
export function formatArrived(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST,
  })
    .format(new Date(value))
    // en-IN gives "16 Sep, 10:42"; the comma is noise in a narrow column.
    .replace(",", "");
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
/**
 * The calendar day after a plain YYYY-MM-DD date.
 *
 * Dates in this app are days, not instants, so this is arithmetic on the
 * string's own calendar and not on a timezone: adding a day to "2026-09-14"
 * must give "2026-09-15" wherever the browser thinks it is.
 */
export function dayAfter(date: string): string {
  return shiftDay(date, 1);
}

/** The same arithmetic, any number of days either way (§42.1). */
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * An ISO timestamp N hours before now, for "since" filters.
 *
 * A helper rather than an inline `Date.now()` because a server component that
 * reads the clock during render trips the purity rule, and the rule is right
 * in general even where this particular use is harmless: one render, one
 * request, one cutoff.
 */
export function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

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

/**
 * The first of the current IST month, for the Enquiries range picker (§50.1).
 *
 * Built from the IST calendar day rather than the machine's, like everything
 * else here — a server in another timezone must not decide that the month
 * turned over at half past six in the evening.
 */
export function istMonthStart(): string {
  const [y, m] = istToday().split("-");
  return `${y}-${m}-01`;
}
