/**
 * Reading an arrival time out of somebody else's spreadsheet (§48.2).
 *
 * The file is whatever the source system exported. Shopify writes
 * "2026-09-16 10:42:00 +0530"; a hand-kept sheet writes "16/09/2026 10:42";
 * Excel hands the browser a Date whose toString is a sentence; and a cell
 * formatted as a date but read as a number is a serial like 46281.4458. All of
 * those mean one instant, and a counsellor mapping a column should not have to
 * know which dialect their file speaks.
 *
 * Two rules decide the awkward cases:
 *
 *   A bare date with no offset is IST. The whole product runs on one clock
 *   (§4) and the files come from an Indian business, so reading "16/09/2026
 *   10:42" as UTC would file every morning's leads five and a half hours
 *   early — occasionally on the wrong day.
 *
 *   An ambiguous d/m/y is read day-first. "05/09/2026" is the 5th of
 *   September, not the 9th of May. That is the Indian convention and the one
 *   these files are written in; a US-format file would be misread, which is
 *   why the importer shows the parsed result back before anything is written.
 */

/** IST is UTC+5:30 all year — no daylight saving, so a constant is honest. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** Build the ISO instant for a wall-clock reading taken in IST. */
function fromIst(
  y: number,
  mo: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
): string {
  return new Date(
    Date.UTC(y, mo - 1, d, hh, mm, ss) - IST_OFFSET_MINUTES * 60_000,
  ).toISOString();
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/**
 * One arrival instant as an ISO string, or null if the cell says nothing this
 * understands.
 *
 * Null rather than a guess: a wrong arrival time is worse than none, because
 * none falls back to created_at and is visibly approximate, while a wrong one
 * looks exact.
 */
export function parseArrivedAt(input: unknown): string | null {
  if (input == null) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input.toISOString();
  }

  // A cell formatted as a date but read as a number: days since 1899-12-30,
  // the epoch Excel and Sheets both count from. The fractional part is the
  // time of day, and it is a wall-clock reading, so it is IST.
  if (typeof input === "number" && Number.isFinite(input)) {
    return serialToIso(input);
  }

  const raw = String(input).trim();
  if (!raw) return null;

  // Bare serial as text.
  if (/^\d{5}(\.\d+)?$/.test(raw)) return serialToIso(Number(raw));

  // Anything carrying an explicit offset or a Z is unambiguous. Shopify's
  // "+0530" has no colon, which Date.parse rejects on some engines, so it is
  // normalised first. The space between date and time becomes a T for the
  // same reason.
  const offset = raw.match(/(Z|[+-]\d{2}:?\d{2})$/i);
  if (offset) {
    const normalised = raw
      .replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T")
      // Shopify separates the offset with a space — "…10:42:00 +0530" — which
      // Date.parse will not read. Without this the whole branch falls through
      // to the no-offset path below and the time is taken as IST wall clock:
      // right by luck for +0530, five and a half hours wrong for everything
      // else.
      .replace(/\s+([+-]\d{2}:?\d{2})$/, "$1")
      .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const t = Date.parse(normalised);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }

  // ExcelJS hands back a Date; String() on it gives a long sentence that the
  // engine can read back, offset and all.
  if (/^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}/.test(raw)) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }

  const time = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  let hh = time ? Number(time[1]) : 0;
  const mm = time ? Number(time[2]) : 0;
  const ss = time && time[3] ? Number(time[3]) : 0;
  if (time?.[4]) {
    const pm = time[4].toLowerCase() === "pm";
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  if (hh > 23 || mm > 59 || ss > 59) return null;

  // yyyy-mm-dd, with or without a time after it.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]))
      ? fromIst(Number(iso[1]), Number(iso[2]), Number(iso[3]), hh, mm, ss)
      : null;
  }

  // d/m/yyyy and d-m-yyyy, day first.
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    return valid(y, mo, d) ? fromIst(y, mo, d, hh, mm, ss) : null;
  }

  // "16 Sep 2026", "16 September 2026 10:42".
  const named = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (named) {
    const mo = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    const d = Number(named[1]);
    const y = Number(named[3]);
    return mo > 0 && valid(y, mo, d) ? fromIst(y, mo, d, hh, mm, ss) : null;
  }

  return null;
}

function valid(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  if (y < 1990 || y > 2100) return false;
  // Rejects 31 April and the like, which would otherwise roll into May.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function serialToIso(serial: number): string | null {
  if (serial <= 0 || serial > 80_000) return null;
  const days = Math.floor(serial);
  const fraction = serial - days;
  // 1899-12-30 is the epoch both Excel and Sheets count from.
  const base = Date.UTC(1899, 11, 30) + days * 86_400_000;
  const secondsIntoDay = Math.round(fraction * 86_400);
  const d = new Date(base);
  return fromIst(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    Math.floor(secondsIntoDay / 3600),
    Math.floor((secondsIntoDay % 3600) / 60),
    secondsIntoDay % 60,
  );
}
