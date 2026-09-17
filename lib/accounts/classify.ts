/**
 * §50D.1(c). What kind of thing was sold.
 *
 * The importer needs three answers from a product title before it can ask for
 * a rate: which level, which product type, and whether it is a combo. This is
 * where those rules live so that the importer, the seeder and anyone reading
 * the Rates screen are working from one definition.
 *
 * The ordering is the whole point. Books is decided first and wins outright:
 * a books title that says "Combo" is naming the bundle the book accompanies,
 * not a combo product, and a books line has its own percentage in the single
 * grid. Deciding combo first — which is what the title-keyed design did —
 * sent those lines to the combo grid, where they matched nothing and came
 * back unrated.
 *
 * Only after Books has been ruled out does "Combo" in the head mean a combo.
 * In the head specifically: a suffix like "(Combo Offer)" or "- Combo Books"
 * describes what the purchase came with, and §50A.7 already settled that as a
 * books add-on rather than a change of product.
 */

export const SALE_KINDS = ["single", "combo"] as const;
export type SaleKind = (typeof SALE_KINDS)[number];

export type Classified = {
  level: string | null;
  product_type: string | null;
  is_combo: boolean;
  has_books_addon: boolean;
  sale_kind: SaleKind;
};

/** "By" ends the product and starts the teacher; the head is everything before. */
function head(title: string): string {
  return title.replace(/\s+by\s+.*$/i, "");
}

/** Everything after the head — delivery notes, add-ons, the term. */
function suffix(title: string): string {
  const h = head(title);
  return title.slice(h.length);
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/**
 * §50A.5. "CA / CMA Final" and "CA/CMA Final" both mean the CA paper — the
 * title is one product sold to both audiences, and it is booked as CA.
 */
// These run against normalised text, where punctuation has already become
// spaces — so "CA / CMA Final" arrives as "ca cma final" and the pattern has
// to say that rather than spelling the slash. Written the other way it fell
// through to the plain CMA rule and booked the line to the wrong institute.
const LEVEL_PATTERNS: [RegExp, string][] = [
  [/\bca\s+cma\s+final\b|\bca\s+final\b/, "CA Final"],
  [/\bca\s+cma\s+inter(mediate)?\b|\bca\s+inter(mediate)?\b/, "CA Inter"],
  [/\bca\s+cma\s+found(ation)?\b|\bca\s+found(ation)?\b/, "CA Foundation"],
  [/\bcma\s+final\b/, "CMA Final"],
  [/\bcma\s+inter(mediate)?\b/, "CMA Inter"],
  [/\bcma\s+found(ation)?\b/, "CMA Foundation"],
  [/\bcs\b/, "CS"],
  [/\bacca\b/, "ACCA"],
  [/\bcfa\b/, "CFA"],
];

export function classifyLevel(title: string): string | null {
  const n = norm(title).replace(/\s+/g, " ");
  for (const [re, level] of LEVEL_PATTERNS) if (re.test(n)) return level;
  return null;
}

/**
 * Books, by the ways a books product names itself in the title head.
 *
 * "Hard copy" is deliberately NOT here, and that distinction is the whole
 * reason this brief re-read the sheet. 651 August lines have a Course Medium
 * of "Google Drive with Hard Copy": those are lectures that ship with printed
 * notes, not books products. Treating "hard copy" as Books classified 97% of
 * the month as Books and would have rated almost every lecture against the
 * books percentage.
 */
const BOOKS = /\bbooks?\b|\bnotes?\b|\bquestion\s*bank\b|\bcracker\b|\bcompiler\b|\bstudy\s*material\b|\bmodule\s*set\b/;

/**
 * The Course Medium column, which answers the question outright when present.
 *
 * Its first segment is the format — "Books / Sep 26", "Google Drive with Hard
 * Copy / May 27" — and a medium of Books means a books product no matter what
 * the title says. Where there is no medium the title head decides.
 */
const MEDIUM_BOOKS = /^e?\s*books?\b/;
const MEDIUM_ADDON = /with\s+(hard\s*copy|books?)/;

function mediumHead(medium: string): string {
  return norm(medium.split("/")[0]).trim();
}

/**
 * §50A.6. Delivery types, matched on the head only. "Batch" and "Lectures"
 * are Full — a regular batch is the full course under another name.
 */
const TYPE_PATTERNS: [RegExp, string][] = [
  [/\bexam\s*orient(ed|ation)?\b|\beo\b/, "EO"],
  [/\bfast\s*track\b|\bft\b/, "FT"],
  [/\brapid\b|\brevision\b/, "Rapid"],
  [/\bfull\b|\bregular\b|\bbatch\b|\blectures?\b|\bclasses\b|\bcomplete\b/, "Full"],
];

export function classify(title: string, medium?: string | null): Classified {
  const raw = title ?? "";
  const h = norm(head(raw));
  const med = medium ? mediumHead(medium) : "";
  const addonFromMedium = med ? MEDIUM_ADDON.test(med) : false;

  // 1. Books first, and it settles the matter. The medium is believed over the
  // title: a title can mention notes it merely includes, the medium cannot.
  const isBooks = med ? MEDIUM_BOOKS.test(med) : BOOKS.test(h);
  if (isBooks) {
    return {
      level: classifyLevel(raw),
      product_type: "Books",
      is_combo: false,
      has_books_addon: false,
      sale_kind: "single",
    };
  }

  // 2. A lecture product. Combo only if the head says so.
  const isCombo = /\bcombo\b/.test(h);
  const hasBooksAddon = addonFromMedium || /\bbooks?\b|\bhard\s*copy\b/.test(norm(suffix(raw)));

  let type: string | null = null;
  for (const [re, t] of TYPE_PATTERNS) {
    if (re.test(h)) { type = t; break; }
  }
  // A lecture product with no delivery word named is the full course.
  if (!type) type = "Full";

  return {
    level: classifyLevel(raw),
    product_type: type,
    is_combo: isCombo,
    has_books_addon: hasBooksAddon,
    sale_kind: isCombo ? "combo" : "single",
  };
}

/** Titles the rules are checked against; see classify.test.mjs. */
export const CLASSIFY_SAMPLES: { title: string; level: string | null; type: string; combo: boolean }[] = [
  { title: "CA Final AFM Regular Batch by CA Aaditya Jain",
    level: "CA Final", type: "Full", combo: false },
  { title: "CA Final DT and IDT Combo by CA Bhanwar Borana",
    level: "CA Final", type: "Full", combo: true },
  // the rule this brief exists to fix
  { title: "CA Final DT and IDT Combo Books by CA Bhanwar Borana",
    level: "CA Final", type: "Books", combo: false },
  { title: "CA Inter Law Books - Hard Copy",
    level: "CA Inter", type: "Books", combo: false },
  { title: "CA / CMA Final SFM Fast Track by CA Aaditya Jain",
    level: "CA Final", type: "FT", combo: false },
  { title: "CMA Inter Group I Exam Oriented",
    level: "CMA Inter", type: "EO", combo: false },
  { title: "CA Foundation Maths Combo (Combo Offer)",
    level: "CA Foundation", type: "Full", combo: true },
  // "Combo" only in the suffix: an add-on, not a combo product
  { title: "CA Final AFM Regular by CA X - Combo Offer",
    level: "CA Final", type: "Full", combo: false },
];
