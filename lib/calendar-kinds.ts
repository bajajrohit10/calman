/**
 * §88. What a row in the holidays table means, in words.
 *
 * The table has held both kinds since §54.2(b) — a date that closes an
 * otherwise-working day, and a date that opens an otherwise-closed one — but
 * only as `is_working_override`, a boolean that reads as a flag on a holiday
 * rather than as the two kinds of calendar override it actually is. The storage
 * stays a boolean, deliberately: `app.is_working_day` and the five functions
 * behind it already branch on it, and a second column naming the same fact is
 * how the two would come to disagree. This is the vocabulary layer over it, so
 * every human-facing surface says "holiday" and "working day" rather than
 * "override: true".
 *
 * A plain module, not part of the "use client" view: the server action reads
 * the same names, and a const exported from a client module reaches the server
 * as a module reference rather than as an array (the §83 lesson).
 */

export const CALENDAR_KINDS = ["holiday", "working_day"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  holiday: "Holiday",
  working_day: "Working day",
};

/** Anything unrecognised is a holiday: that is the default the column has. */
export function asCalendarKind(v: string | null | undefined): CalendarKind {
  return CALENDAR_KINDS.find((k) => k === v) ?? "holiday";
}

/** The one place the vocabulary meets the column. */
export function kindToOverride(kind: CalendarKind): boolean {
  return kind === "working_day";
}

export function overrideToKind(isWorkingOverride: boolean): CalendarKind {
  return isWorkingOverride ? "working_day" : "holiday";
}
