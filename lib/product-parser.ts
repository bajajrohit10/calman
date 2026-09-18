/**
 * Reading interest lines out of a product title (§49.1).
 *
 * Zeroinfy's catalogue titles follow one shape:
 *
 *   <Course> <Subject(s)> <content words> By <Teacher(s)> [For …] – <delivery> / <Term>
 *
 * "CA Final DT Regular Course By CA Bhanwar Borana – Google Drive / May 27"
 *
 * That is enough structure to recover what a student asked about without
 * anybody typing it twice. It is not enough to be trusted silently, which is
 * why §49.2 marks every line this produces as auto and shows it in red until a
 * human has looked: the parser is a good guess, and a good guess presented as
 * a fact is worse than no guess at all.
 *
 * Pure and master-driven on purpose. The dictionary is built from the master
 * lists at call time rather than hard-coded, so adding a teacher in Settings
 * teaches the parser about them; only the aliases — the short forms a title
 * uses that no master list contains — live here.
 */

export type Named = { id: string; name: string };
export type SubjectMaster = Named & { course_id: string };

export type ParserMasters = {
  courses: Named[];
  subjects: SubjectMaster[];
  contents: Named[];
  terms: Named[];
  teachers: Named[];
  /**
   * §55.1. Only used to resolve a teacher hint that names a house rather than
   * a person — "Vsmart Academy" on a Shopify line item. Optional, because
   * every existing caller builds masters without it and the parser must read
   * exactly the same without one.
   */
  institutes?: (Named & { teacherIds?: string[] })[];
};

export type ParsedLine = {
  courseId: string | null;
  subjectId: string | null;
  contentId: string | null;
  teacherId: string | null;
  /** Set when a name after "By" matched nothing — §49.1 asks for these by name. */
  unmatchedTeacher: string | null;
};

export type ParsedProduct = {
  /** The slice of the original text this came from. */
  raw: string;
  courseId: string | null;
  termId: string | null;
  lines: ParsedLine[];
  /** How each field was arrived at, for the coverage report and for tuning. */
  trace: {
    course: string | null;
    subjects: string[];
    content: string | null;
    contentRulesFired: string[];
    term: string | null;
    teachers: { raw: string; matched: string | null; how: "exact" | "fuzzy" | "none" }[];
    pairing: "one-to-one" | "cross" | "none";
    /** §55.1: the teacher came from the file's Vendor, not from the title. */
    usedTeacherHint?: boolean;
  };
};

/* ------------------------------------------------------------------ text -- */

const DASHES = /[‐-―−]/g;

function tidy(s: string): string {
  return s
    .replace(DASHES, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const norm = (s: string) => tidy(s).toLowerCase().replace(/[.]/g, "");

/** Letters and digits only — for comparing names through punctuation. */
const squash = (s: string) => norm(s).replace(/[^a-z0-9]/g, "");

/**
 * Punctuation flattened to spaces, on both sides of every comparison.
 *
 * Real titles write the short form in brackets — "Financial Reporting (FR)",
 * "Financial and Strategic Management (FM SM)" — and master names carry their
 * own punctuation: "AFM/SFM", "Set A - Law", "FM & DA (Paper 11)". Searching
 * for " fr " in "…reporting (fr) regular…" finds nothing unless both are
 * flattened the same way, so both are.
 */
const flat = (s: string) => ` ${norm(s).replace(/[^a-z0-9]+/g, " ").trim()} `;

/* --------------------------------------------------------------- courses -- */

/**
 * Course names as titles write them.
 *
 * "CA/CMA Final" means the CA course (§49.1): the title is one product sold to
 * both audiences, and the CA row is the one the catalogue is organised by.
 */
const COURSE_ALIASES: Record<string, string[]> = {
  "CA Final": ["ca final", "ca/cma final", "ca / cma final", "ca-final", "cafinal"],
  "CA Inter": [
    "ca inter", "ca intermediate", "ca/cma inter", "ca / cma inter",
    "ca ipcc", "ipcc", "ca-inter",
  ],
  "CA Foundation": ["ca foundation", "ca/cma foundation", "ca cpt", "ca-foundation"],
  "CMA Final": ["cma final", "icwa final"],
  "CMA Inter": ["cma inter", "cma intermediate", "icwa inter"],
  "CMA Foundation": ["cma foundation", "icwa foundation"],
  CS: ["cs executive", "cs professional", "cs foundation", "cs"],
  ACCA: ["acca"],
  CFA: ["cfa"],
};

/** The words a product title may open with — used to split multi-product text. */
const COURSE_OPENERS = Object.values(COURSE_ALIASES).flat();

/* -------------------------------------------------------------- subjects -- */

/**
 * Short forms that appear in titles and in no master list.
 *
 * Each alias names one or more *master subject names*; which one is meant is
 * decided by the course on the title, because "SFM" is a CA Final subject and
 * also a CMA Final one, and "Direct Tax" is both. Resolution is therefore
 * alias → candidate names → the candidate whose course matches.
 */
const SUBJECT_ALIASES: Record<string, string[]> = {
  fr: ["FR", "CFR (Paper 18)"],
  "financial reporting": ["FR", "CFR (Paper 18)"],
  afm: ["AFM/SFM"],
  sfm: ["AFM/SFM", "SFM (Paper 14)"],
  "afm/sfm": ["AFM/SFM"],
  "advanced financial management": ["AFM/SFM"],
  "strategic financial management": ["AFM/SFM", "SFM (Paper 14)"],
  dt: ["Direct Tax", "Direct Tax (Paper 15)", "Taxation"],
  "direct tax": ["Direct Tax", "Direct Tax (Paper 15)"],
  idt: ["Indirect Tax", "Indirect Tax (Paper 19)", "Taxation"],
  "indirect tax": ["Indirect Tax", "Indirect Tax (Paper 19)"],
  // CA Inter has no separate indirect-tax paper: GST is examined inside
  // Taxation, so the course scoping resolves "CA Inter GST" to Taxation and
  // "CA Final GST" to Indirect Tax off the same alias.
  gst: ["Indirect Tax", "Indirect Tax (Paper 19)", "Taxation"],
  tax: ["Taxation", "Direct & Indirect Tax (Paper 7)"],
  taxation: ["Taxation", "Direct & Indirect Tax (Paper 7)"],
  "adv acc": ["Advanced Accounting"],
  // The catalogue writes it without the "d" about as often as with it.
  "advance accounts": ["Advanced Accounting"],
  "advance accounting": ["Advanced Accounting"],
  "accounting standards": ["Advanced Accounting"],
  "advanced accounts": ["Advanced Accounting"],
  "advanced accounting": ["Advanced Accounting"],
  accounts: ["Accounts", "Financial Accounts (Paper 6)"],
  accounting: ["Accounts", "Financial Accounts (Paper 6)"],
  "fm sm": ["FM SM"],
  "fm & sm": ["FM SM"],
  "fm and sm": ["FM SM"],
  fm: ["FM SM", "FM & DA (Paper 11)"],
  sm: ["FM SM", "OM & SM (Paper 9)"],
  costing: ["Costing", "Set B - Costing", "Cost Accounts (Paper 8)"],
  cost: ["Costing", "Set B - Costing", "Cost Accounts (Paper 8)"],
  "cost accounting": ["Costing", "Cost Accounts (Paper 8)"],
  audit: ["Audit", "Audit and Ethics", "Cost Audit (Paper 17)"],
  auditing: ["Audit", "Audit and Ethics"],
  "audit and ethics": ["Audit and Ethics"],
  law: ["Set A - Law", "Corporate Law", "Law", "Business Law (Paper 5)"],
  "corporate law": ["Corporate Law", "Corporate Law (Paper 13)"],
  "business law": ["Law", "Business Law (Paper 5)"],
  // SCM is a CMA Final paper in its own right and, for CA Final, half of the
  // Set B paper the catalogue still calls by its old names.
  scm: ["SCM (Paper 16)", "Set B - Costing"],
  "scm spm": ["Set B - Costing"],
  spm: ["Set B - Costing"],
  scpm: ["Set B - Costing"],
  // CMA Final papers the titles name by their short forms.
  cfr: ["CFR (Paper 18)"],
  ents: ["Elective Entrepreneurship And Startup (Paper 20C)"],
  entrepreneurship: ["Elective Entrepreneurship And Startup (Paper 20C)"],
  "entrepreneurship and startups": ["Elective Entrepreneurship And Startup (Paper 20C)"],
  "risk management": ["Elective Risk Management (Paper 20B)"],
  spmbv: ["Elective SPMBV (Paper 20A)"],
  "law paper 13": ["Corporate Law (Paper 13)"],
  "cost audit": ["Cost Audit (Paper 17)"],
  ibs: ["Integrated Business Solutions"],
  "integrated business solutions": ["Integrated Business Solutions"],
  "spom set a": ["Set A - Law"],
  "spom set b": ["Set B - Costing"],
  "set a": ["Set A - Law"],
  "set b": ["Set B - Costing"],
  spom: ["Set A - Law", "Set B - Costing"],
  economics: ["Economics", "Business Economics & Mgmt (Paper 4)"],
  maths: ["Maths & Stats", "Business Maths & Stats (Paper 3)"],
  "maths & stats": ["Maths & Stats"],
  stats: ["Maths & Stats"],
};

/* -------------------------------------------------------------- contents -- */

/**
 * §49.1's content rules, in the order the brief states them.
 *
 * The order matters and is deliberately the brief's: Books first, then Exam
 * Oriented — which beats Fast Track even when both words appear — then Fast
 * Track, then the full-course words, then Test Series. `contentRulesFired`
 * records every rule that would have matched, so the report can say how often
 * the precedence actually decided something rather than leaving it a guess.
 */
const CONTENT_RULES: { content: string; label: string; re: RegExp }[] = [
  {
    content: "Books",
    label: "books",
    re: /\b(books?|notes?|question bank|qb|module|compact|cracker|summary)\b/i,
  },
  { content: "EO", label: "exam-oriented", re: /\bexam[- ]?oriented\b/i },
  { content: "FT", label: "fast-track", re: /\b(fast[- ]?track|ft)\b/i },
  {
    content: "Full",
    label: "full",
    re: /\b(regular|full course|in[- ]?depth|live batch|video lectures?)\b/i,
  },
  { content: "Test Series", label: "test-series", re: /\btest series\b/i },
];

/** Words about how a product is delivered, never about what it is. */
const DELIVERY = /\b(google drive|g[- ]?drive|mobile app|hard copy|soft copy|copy from cent(er|re)|live guidance|pen ?drive|recorded|english|hindi|hinglish|download|streaming)\b/gi;

/* ------------------------------------------------------------------ term -- */

const MONTHS: Record<string, string> = {
  jan: "Jan", feb: "Feb", mar: "Mar", apr: "Apr", may: "May", jun: "Jun",
  jul: "Jul", aug: "Aug", sep: "Sep", sept: "Sep", oct: "Oct", nov: "Nov", dec: "Dec",
};

/**
 * "May 27", "Nov-26", "Jan 2027", "Nov 26 and Onwards" → "May-27" etc.
 *
 * Only the first month-year in the segment: "Nov 26 and Onwards" names one
 * term and a policy, and the policy is not a term.
 */
export function normaliseTerm(segment: string): string | null {
  const m = tidy(segment)
    .toLowerCase()
    .match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s\-/']*((?:20)?\d{2})\b/);
  if (!m) return null;
  const mon = MONTHS[m[1] === "sept" ? "sept" : m[1]];
  if (!mon) return null;
  const yy = m[2].length === 4 ? m[2].slice(2) : m[2];
  return `${mon}-${yy}`;
}

/* -------------------------------------------------------------- teachers -- */

/** Titles people put before a name, none of which are part of it. */
const HONORIFICS = /^(ca|cs|cma|adv|advocate|prof|professor|dr|mr|mrs|ms|shri|sri)\.?\s+/i;

/**
 * A teacher's name with the catalogue's decorations taken off.
 *
 * Titles append qualifiers in brackets — "(MVSIR)", "(Giveaway)", "(9th
 * Edition)" — which belong to the product, not the person. And splitting a
 * title on "/" can cut through "(Hindi / English)", leaving a name ending in
 * a half-open bracket; an unclosed bracket is always a cut, so everything
 * from it is dropped.
 */
export function stripDecorations(name: string): string {
  return tidy(
    tidy(name)
      .replace(/\([^)]*\)/g, " ")   // complete brackets: a product qualifier
      .replace(/\(.*$/, " ")        // an unclosed one: the tail of a cut
      .replace(/\s+/g, " "),
  );
}

export function stripHonorifics(name: string): string {
  let out = stripDecorations(name);
  for (;;) {
    const next = out.replace(HONORIFICS, "");
    if (next === out) return next;
    out = next;
  }
}

/** Levenshtein, capped — anything past the cap is "too far" and stops early. */
export function levenshtein(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * One name from a title against the teacher master: exact, then fuzzy.
 *
 * Fuzzy is Levenshtein ≤ 2 on the squashed name, or a token match — every word
 * of the shorter name appearing in the longer, which is what catches "Bhanwar
 * Borana" against "CA Bhanwar Borana Sir" and initials-vs-full-name.
 */
export function matchTeacher(
  raw: string,
  teachers: Named[],
): { id: string | null; name: string | null; how: "exact" | "fuzzy" | "none" } {
  const clean = stripHonorifics(raw);
  if (!clean) return { id: null, name: null, how: "none" };
  const target = squash(clean);
  if (!target) return { id: null, name: null, how: "none" };

  for (const t of teachers) {
    if (squash(t.name) === target) return { id: t.id, name: t.name, how: "exact" };
  }

  let best: { t: Named; d: number } | null = null;
  const words = norm(clean).split(/\s+/).filter((w) => w.length > 2);
  for (const t of teachers) {
    const cand = squash(t.name);
    const d = levenshtein(target, cand, 2);
    if (d <= 2 && (!best || d < best.d)) best = { t, d };

    if (!best || best.d > 0) {
      const tw = norm(t.name).split(/\s+/).filter((w) => w.length > 2);
      const short = words.length <= tw.length ? words : tw;
      const long = words.length <= tw.length ? tw : words;
      // Two tokens at least. One is a surname, and a surname on its own is not
      // an identification: it matched "K M Bansal" to "Abhishek Bansal", who
      // is a different person, and would do the same to every Sharma and Jain
      // in a master list of seventy-three.
      if (short.length >= 2 && short.every((w) => long.includes(w))) {
        if (!best || best.d > 1) best = { t, d: 1 };
      }
    }
  }
  if (best) return { id: best.t.id, name: best.t.name, how: "fuzzy" };
  return { id: null, name: null, how: "none" };
}

/* ----------------------------------------------------------------- parse -- */

/**
 * Split one product-text field into the separate products it may hold.
 *
 * §49.1: on ", " only where what follows opens with a course word. A title is
 * full of commas that separate subjects and teachers, and splitting on all of
 * them would shred one product into nonsense.
 *
 * §55.1 adds a pipe. Where the comma rule has to guess — is this comma between
 * two products or between two subjects? — a " | " never does: nothing in the
 * catalogue's own titles contains one, so it only ever appears because
 * something joined two titles together. The Shopify import does exactly that
 * when one student abandoned two checkouts, and without this the two titles
 * reached the parser as one blob and produced one interest line.
 *
 * Pipes are split first and unconditionally; each piece then goes through the
 * comma rule as before, so a piece that is itself two comma-joined products
 * still comes apart.
 */
export function splitProducts(text: string): string[] {
  const t = tidy(text);
  if (!t) return [];
  return t
    .split("|")
    .flatMap((piece) => splitOnCourseOpeners(tidy(piece)))
    .map(tidy)
    .filter(Boolean);
}

function splitOnCourseOpeners(t: string): string[] {
  if (!t) return [];
  const parts: string[] = [];
  let start = 0;
  const re = /,\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const rest = t.slice(m.index + m[0].length).toLowerCase();
    if (COURSE_OPENERS.some((c) => rest.startsWith(c))) {
      parts.push(t.slice(start, m.index));
      start = m.index + m[0].length;
    }
  }
  parts.push(t.slice(start));
  return parts;
}

function findCourse(text: string, masters: ParserMasters) {
  const n = norm(text);
  let hit: { name: string; at: number } | null = null;
  for (const [name, aliases] of Object.entries(COURSE_ALIASES)) {
    for (const a of aliases) {
      const at = n.indexOf(a);
      // Earliest match wins: the course leads the title.
      if (at >= 0 && (!hit || at < hit.at)) hit = { name, at };
    }
  }
  if (!hit) return { id: null, name: null };
  const row = masters.courses.find((c) => c.name === hit!.name);
  return { id: row?.id ?? null, name: row?.name ?? null };
}

/**
 * The subjects a title names, in the order it names them.
 *
 * Scoped to the detected course wherever an alias is ambiguous. The head of
 * the title — everything before "By" — is searched, because a teacher's name
 * can contain a word that is also a subject ("Aarti Lahoti" has no such
 * problem, but "Cost" appears inside institute names often enough to matter).
 */
function findSubjects(head: string, courseId: string | null, masters: ParserMasters) {
  const n = flat(head);
  const found: { id: string; name: string; at: number }[] = [];

  /**
   * Every way the title could be naming a subject, longest phrase first.
   *
   * Master names and short forms compete in one pass rather than two. Ordering
   * by the length of the matched phrase is what makes the specific beat the
   * general: "Set A - Law" beats "Law", "SPOM Set B" beats "SPOM", "FM SM"
   * beats "FM" — and doing it in two passes let an early short master name
   * claim the words a longer alias needed.
   */
  const candidates: { needle: string; names: string[] }[] = [
    ...masters.subjects.map((s) => ({ needle: flat(s.name), names: [s.name] })),
    ...Object.entries(SUBJECT_ALIASES).map(([alias, names]) => ({
      needle: flat(alias),
      names,
    })),
  ].sort((a, b) => b.needle.length - a.needle.length);

  // Words already spoken for, so a shorter phrase sitting inside a longer one
  // is not counted a second time.
  const claimed: { from: number; to: number }[] = [];

  for (const c of candidates) {
    const at = n.indexOf(c.needle);
    if (at < 0) continue;
    const to = at + c.needle.length;
    if (claimed.some((k) => at < k.to && to > k.from)) continue;

    const rows = c.names
      .map((nm) => masters.subjects.find((s) => s.name === nm))
      .filter((x): x is SubjectMaster => Boolean(x));
    // Ambiguous short forms are resolved by the course on the title: "SFM" is
    // a CA Final paper and a CMA Final one, "DT" is three different things.
    const pick = courseId
      ? (rows.find((x) => x.course_id === courseId) ?? null)
      : (rows[0] ?? null);

    // Claimed only when it actually resolved. A phrase that matched the text
    // but named no subject of this course has not consumed those words —
    // "Law" under CA Final is not a subject, and letting it claim the range
    // stopped "Set A - Law" from being found at all.
    if (!pick) continue;
    claimed.push({ from: at, to });
    if (!found.some((f) => f.id === pick.id)) {
      found.push({ id: pick.id, name: pick.name, at });
    }
  }

  return found.sort((a, b) => a.at - b.at);
}

function findContent(text: string, masters: ParserMasters) {
  const stripped = tidy(text).replace(DELIVERY, " ");
  const fired: string[] = [];
  for (const rule of CONTENT_RULES) {
    if (rule.re.test(stripped)) fired.push(rule.label);
  }
  if (!fired.length) return { id: null, name: null, fired };
  const chosen = CONTENT_RULES.find((r) => r.label === fired[0])!;
  const row = masters.contents.find((c) => c.name === chosen.content);
  return { id: row?.id ?? null, name: row?.name ?? null, fired };
}

/** One product title → the lines it describes. */
/**
 * §55.1. A teacher named by the file rather than by the title.
 *
 * Shopify's export carries a Vendor per line item, which is usually the
 * teacher and sometimes the house they sell through. It is a hint and never
 * more than that: the title is the thing the student actually read, so a
 * teacher found by scanning it always wins. The hint only fills a gap.
 */
export type ParseOptions = { teacherHint?: string | null };

export function parseProduct(
  text: string,
  masters: ParserMasters,
  options: ParseOptions = {},
): ParsedProduct {
  const raw = tidy(text);

  // The term lives after the last "/", which also ends the delivery segment.
  const lastSlash = raw.lastIndexOf("/");
  const termSegment = lastSlash >= 0 ? raw.slice(lastSlash + 1) : "";
  // §49 decision 2. The last segment first, because when a title ends in a
  // term that is the term it is for. When it ends in something else — "/
  // Without Hard Copy", "/ Prev ED Books" — the exam is named earlier, in a
  // "For Nov 26, May 27" clause, and the first one there is the nearest. That
  // recovers 152 of the 167 titles the strict rule left blank.
  const termName = normaliseTerm(termSegment) ?? normaliseTerm(raw);
  const termId = termName
    ? (masters.terms.find((t) => norm(t.name) === norm(termName))?.id ?? null)
    : null;

  // "By" splits what was taught from who taught it. "For …" is an audience
  // note and belongs to neither.
  const byMatch = raw.match(/\bby\b/i);
  const head = byMatch ? raw.slice(0, byMatch.index) : raw;
  const tailRaw = byMatch ? raw.slice(byMatch.index! + 2) : "";
  const tail = tailRaw.split(/\bfor\b/i)[0].split(/[-–—]/)[0].split("/")[0];

  const course = findCourse(head, masters);
  const subjects = findSubjects(head, course.id, masters);
  const content = findContent(raw, masters);

  const teacherNames = tail
    .split(/\band\b|&|,/i)
    .map((s) => stripHonorifics(s))
    .map(tidy)
    .filter((s) => s.length > 1);

  const scanned = teacherNames.map((rawName) => {
    const m = matchTeacher(rawName, masters.teachers);
    return { raw: rawName, matched: m.name, id: m.id, how: m.how };
  });

  // §55.1. The hint is consulted only when the scan found nobody at all. A
  // scan that found a name the master list does not know still counts as
  // having found somebody — the title said who taught it, and overruling that
  // with a vendor field would be the file correcting the student.
  const hinted =
    scanned.length === 0 ? resolveTeacherHint(options.teacherHint, masters) : null;
  const teachers = hinted ? [hinted] : scanned;
  const usedHint = Boolean(hinted);

  // §49.1's pairing rule: teacher i with subject i when the counts agree —
  // "DT and IDT By A and B" is two courses taught by two people — otherwise
  // everybody taught everything.
  const oneToOne = subjects.length > 1 && subjects.length === teachers.length;
  const pairing: ParsedProduct["trace"]["pairing"] =
    !teachers.length ? "none" : oneToOne ? "one-to-one" : "cross";

  const lines: ParsedLine[] = [];
  const push = (subjectId: string | null, t: (typeof teachers)[number] | null) => {
    lines.push({
      courseId: course.id,
      subjectId,
      contentId: content.id,
      teacherId: t?.id ?? null,
      unmatchedTeacher: t && !t.id ? t.raw : null,
    });
  };

  if (!subjects.length && !teachers.length) {
    if (course.id || content.id) push(null, null);
  } else if (!subjects.length) {
    for (const t of teachers) push(null, t);
  } else if (!teachers.length) {
    for (const s of subjects) push(s.id, null);
  } else if (oneToOne) {
    subjects.forEach((s, i) => push(s.id, teachers[i]));
  } else {
    for (const s of subjects) for (const t of teachers) push(s.id, t);
  }

  return {
    raw,
    courseId: course.id,
    termId,
    lines,
    trace: {
      course: course.name,
      subjects: subjects.map((s) => s.name),
      content: content.name,
      contentRulesFired: content.fired,
      term: termName,
      teachers: teachers.map((t) => ({ raw: t.raw, matched: t.matched, how: t.how })),
      pairing,
      usedTeacherHint: usedHint,
    },
  };
}

/**
 * A vendor string to one teacher, or nothing.
 *
 * Two ways in: the vendor names a teacher the master list knows, or it names
 * an institute that has exactly one teacher behind it. An institute with
 * several teachers resolves to none of them — "Vsmart Academy" does not say
 * which of its faculty this title is, and guessing would put a real person's
 * name on a lead they never spoke to.
 */
function resolveTeacherHint(
  hint: string | null | undefined,
  masters: ParserMasters,
): {
  raw: string;
  matched: string | null;
  id: string | null;
  how: "exact" | "fuzzy" | "none";
} | null {
  const raw = tidy(hint ?? "");
  if (!raw) return null;

  const direct = matchTeacher(raw, masters.teachers);
  if (direct.id) return { raw, matched: direct.name, id: direct.id, how: direct.how };

  const house = (masters.institutes ?? []).find(
    (i) => squash(i.name) === squash(raw),
  );
  if (house?.teacherIds?.length === 1) {
    const t = masters.teachers.find((x) => x.id === house.teacherIds![0]);
    if (t) return { raw, matched: t.name, id: t.id, how: "fuzzy" };
  }
  return null;
}

/** A whole product-text field, which may name more than one product. */
export function parseProductText(
  text: string,
  masters: ParserMasters,
  options: ParseOptions = {},
): ParsedProduct[] {
  return splitProducts(text).map((p) => parseProduct(p, masters, options));
}
