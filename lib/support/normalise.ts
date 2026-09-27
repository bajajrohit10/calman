/**
 * §58.3. Turning one Google Form row into a support ticket's fields.
 *
 * Pure, client-safe, and deliberately separate from the endpoint: the intake
 * webhook, the "New ticket" form and the Playwright checks all have to agree
 * about what a mobile number is, and three copies of that rule would be three
 * answers. Every function here is measured against the 5,530-row July-2025
 * feed; the counts in the comments are from that data.
 */

/**
 * The five checkbox options, exactly as the form emits them.
 *
 * Must stay identical to support.issue_options() in the database — the column
 * check constraint reads that one, and a value this module invents would be
 * rejected on insert rather than quietly stored.
 */
export const ISSUE_OPTIONS = [
  "Tracking ID Issues",
  "Courier & Delivery Issues",
  "Link / Serial Key Mail not received",
  "Technical Issue / Course Extension",
  "Received Damaged/Defective Product",
] as const;

export type IssueOption = (typeof ISSUE_OPTIONS)[number];

export function isIssueOption(v: string): v is IssueOption {
  return (ISSUE_OPTIONS as readonly string[]).includes(v);
}

/**
 * A mobile number, or null.
 *
 * The first valid 10-digit run, not "strip every non-digit from the cell":
 * four historic rows hold two numbers separated by a slash, and stripping the
 * lot yields 20 digits and therefore nothing, discarding a number that was
 * perfectly usable. 98% of the feed normalises; the rest is students typing an
 * order id or an email address into the mobile box.
 */
export function normaliseSupportMobile(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  // Each maximal digit run, longest-first repairs applied per run.
  for (const run of text.match(/\d+/g) ?? []) {
    const candidate = trimCountryCode(run);
    if (/^[6-9]\d{9}$/.test(candidate)) return candidate;
  }

  // A number written with spaces inside — "98337 53287", 888 rows — is one run
  // per group, so the per-run pass above misses it. Join the digits and retry.
  const joined = trimCountryCode(text.replace(/\D/g, ""));
  return /^[6-9]\d{9}$/.test(joined) ? joined : null;
}

/** 91-, 0- and 0091-style prefixes, peeled while something is still over. */
function trimCountryCode(digits: string): string {
  let d = digits;
  while (d.length > 10 && d.startsWith("0")) d = d.slice(1);
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  while (d.length > 10 && d.startsWith("0")) d = d.slice(1);
  return d;
}

/**
 * An order id, or null.
 *
 * The rule is the brief's — trim, uppercase, drop an ORDER prefix, repair
 * Z1/ZL/Zl to ZI — plus the cases the live feed showed it missing:
 *
 *   * "ORDERZI217xxx" has no space, so `^ORDER ` never fired (6 rows);
 *     "Order Id:BBVPL-189509" carries a label and a colon.
 *   * "#179896" leads with a hash.
 *   * "ZI217486 **" and "ZI216xxx Complete" carry trailing noise.
 *   * "ZI216599 & ZI216598" is two orders in one cell (~14 rows). The first is
 *     taken and order_id_raw keeps the pair, because this is exactly the row
 *     where a wrong auto-merge would join two unrelated complaints.
 *   * BBVPL-nnnnnn and BBP-nnnnnn are BB Virtuals' own numbering (108 rows) and
 *     must pass through untouched.
 */
export function normaliseSupportOrderId(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim().toUpperCase();
  if (!s) return null;

  // A label in front of the number, in any of the shapes seen.
  s = s.replace(/^ORDER\s*(?:ID|NO\.?)?\s*[:#-]?\s*/, "");
  s = s.replace(/^[#:]\s*/, "");

  // Two orders in one cell: keep the first.
  const firstOfSeveral = s.split(/\s*(?:&|\bAND\b|,|\/)\s*/).find((p) => p.trim());
  if (firstOfSeveral) s = firstOfSeveral.trim();

  // Trailing decoration — asterisks, stray punctuation, a word like "COMPLETE".
  s = s.replace(/\s+(?:COMPLETE|PENDING|DONE)$/, "");
  s = s.replace(/[^A-Z0-9)]+$/, "");

  // The one repair: a leading digit-one or letter-L where ZI was meant. Applied
  // after upper-casing, which is what collapses "Zl" and "zl" into "ZL" first.
  s = s.replace(/^Z[1L](?=\d)/, "ZI");

  if (!s) return null;

  // Not every cell holds an order reference. Students type "NA", their own
  // name, a course title, an email address. Those must be null rather than
  // stored, because order_id is half the auto-merge key — "NA" as an order id
  // would silently merge every such ticket from one number into one thread.
  // An order reference always carries a run of digits and never an @.
  if (s.includes("@") || !/\d{4}/.test(s)) return null;

  return s;
}

export type ParsedIssues = { issues: IssueOption[]; other: string | null };

/**
 * The Issue cell, split into checkboxes and free text.
 *
 * Subtraction, not a ", " split. Google Forms joins the ticked options with
 * ", " and appends any "Other" text the same way, so splitting looks right
 * until the free text contains a comma of its own — and 11% of historic cells
 * hold no fixed option at all, just prose, sometimes 428 characters of it. A
 * split shatters those into invented categories; removing the five known
 * strings and keeping whatever is left cannot. It is also order-independent,
 * which matters because 108 rows list the options out of form order.
 */
export function parseSupportIssues(raw: string | null | undefined): ParsedIssues {
  const text = (raw ?? "").trim();
  if (!text) return { issues: [], other: null };

  const found: IssueOption[] = [];
  let rest = text;

  // Longest first, so no option can be eaten by a shorter one that is a
  // substring of it.
  for (const option of [...ISSUE_OPTIONS].sort((a, b) => b.length - a.length)) {
    if (rest.includes(option)) {
      found.push(option);
      rest = rest.split(option).join(" ");
    }
  }

  // What is left is free text once the options are gone. Split on the commas
  // and rejoin, which drops the empty fragments the removals left behind
  // without touching a comma the student actually wrote: "I want to cancel,
  // nothing else" keeps its comma, while " ,  , akash" becomes "akash".
  const other = rest
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");

  // Report the options in the form's own order rather than longest-first.
  const issues = ISSUE_OPTIONS.filter((o) => found.includes(o));
  return { issues, other: other || null };
}

/**
 * The Attachment cell as a list.
 *
 * 15 months of history holds exactly one Drive URL per ticket and never a
 * comma, so nothing below is exercised by the current form — but the file
 * upload emits a comma-separated list the moment it allows several files, and
 * discovering that through a truncated URL is not worth saving three lines.
 */
export function parseSupportAttachments(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

/**
 * The lookup key for support.faculty_aliases.
 *
 * Must produce exactly what that table's raw_norm column holds, or a seeded
 * mapping silently stops matching. Trailing separators go because the biggest
 * dropdown option of all ends in a slash.
 */
export function normaliseFacultyKey(raw: string | null | undefined): string | null {
  const s = (raw ?? "")
    .trim()
    .replace(/^(?:CA|CMA|CS|PROF\.?|DR\.?)\s+/i, "")
    .replace(/[\s/,]+$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return s || null;
}

/**
 * Every ", "-separated value in a Faculty cell, each normalised.
 *
 * One cell can name two dropdown options (304 historic rows) and may then add
 * Other text as a third. The caller tries them in order and takes the first
 * that resolves, because a ticket carries one institute and one teacher while
 * faculty_raw keeps the whole thing.
 */
export function facultyCandidates(raw: string | null | undefined): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  const parts = text.split(", ").map((p) => normaliseFacultyKey(p)).filter(Boolean) as string[];
  const whole = normaliseFacultyKey(text);
  // The whole string first: a seeded roster is a single option and must not be
  // beaten by one of its own segments.
  return [...new Set([whole, ...parts].filter(Boolean) as string[])];
}
