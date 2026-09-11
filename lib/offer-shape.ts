/**
 * An offer's shape, and the one rule about it that has to mean the same thing
 * everywhere (Brief 18).
 *
 * Split from lib/offers.ts for the reason lib/report-shape.ts is split from
 * lib/reports.ts: the Settings screen is a client component and imports the
 * column list as a value, and that file is server-only.
 */

export type OfferTargetKey =
  | "institutes"
  | "teachers"
  | "courses"
  | "subjects"
  | "contents";

export type OfferTargets = Record<OfferTargetKey, string[]>;

/** The join table behind each target, so nothing writes the name twice. */
export const TARGET_TABLES = {
  institutes: { table: "offer_institutes", column: "institute_id", label: "Institutes" },
  teachers: { table: "offer_teachers", column: "teacher_id", label: "Teachers" },
  courses: { table: "offer_courses", column: "course_id", label: "Courses" },
  subjects: { table: "offer_subjects", column: "subject_id", label: "Subjects" },
  contents: { table: "offer_contents", column: "content_id", label: "Contents" },
} as const satisfies Record<
  OfferTargetKey,
  { table: string; column: string; label: string }
>;

export const TARGET_KEYS = Object.keys(TARGET_TABLES) as OfferTargetKey[];

export type Offer = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  reminder_days: number;
  is_active: boolean;
  targets: OfferTargets;
};

/** One row of public.offer_performance. */
export type OfferPerformance = {
  offer_id: string;
  name: string;
  start_date: string;
  end_date: string;
  window_from: string;
  reminder_days: number;
  is_active: boolean;
  /** Open leads the targets reach today, whatever the dates say. */
  matches_now: number;
  reached: number;
  called: number;
  won: number;
  won_amount: number;
};

export const OFFER_EXPORT_COLUMNS = [
  { key: "name", label: "Offer" },
  { key: "start_date", label: "Start" },
  { key: "end_date", label: "End" },
  { key: "reminder_days", label: "Reminder days" },
  { key: "window_from", label: "Reminders from" },
  { key: "is_active", label: "Active" },
  { key: "targets", label: "Targets" },
  { key: "matches_now", label: "Matches today" },
  { key: "reached", label: "Reached" },
  { key: "called", label: "Called" },
  { key: "won", label: "Won" },
  { key: "won_amount", label: "Won amount" },
] as const;

/**
 * Where the reminders actually start.
 *
 * The brief defines the window as end_date − reminder_days, but an offer that
 * has not started yet should not be reminded about, so the window opens at
 * whichever is later. Computed here as well as in SQL because the form has to
 * show the answer before anything is saved — the two are asserted against each
 * other by public.offer_performance, which returns the SQL side.
 */
export function offerWindowFrom(
  startDate: string,
  endDate: string,
  reminderDays: number,
): string {
  const d = new Date(`${endDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (Number(reminderDays) || 0));
  const minus = d.toISOString().slice(0, 10);
  return minus > startDate ? minus : startDate;
}

/**
 * The targets as one readable cell, for the export.
 *
 * A spreadsheet reader cannot follow five id columns, and five name columns
 * would make the sheet unreadable for the common case of an offer that names
 * two things. So: "Teachers: A, B · Courses: CA Final", and "Everything" for
 * an offer with no targets at all — which is a real and dangerous
 * configuration, and should read as one.
 */
export function describeTargets(
  targets: OfferTargets,
  names: Record<string, string>,
): string {
  const parts = TARGET_KEYS.flatMap((key) => {
    const chosen = targets[key] ?? [];
    if (!chosen.length) return [];
    const list = chosen
      .map((id) => names[id] ?? "(removed)")
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
    return [`${TARGET_TABLES[key].label}: ${list}`];
  });
  return parts.length ? parts.join(" · ") : "Everything";
}
