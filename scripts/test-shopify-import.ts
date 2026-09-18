/**
 * §55.4. The two-line checkout, which is how a product went missing.
 *
 *   node --experimental-strip-types scripts/test-shopify-import.ts
 *
 * Shopify writes a checkout's Id on its first line only; a second line item
 * repeats the "#"-prefixed Name and leaves Id blank. Nothing else in the file
 * says the two belong together, so if the key falls back to anything other
 * than that Name the second line becomes a checkout of its own — and on
 * 18 September that is what a counsellor saw as a lead with one product where
 * the student had asked about two.
 *
 * The chain asserted here is the whole path from file row to interest line:
 * key → group → join with " | " → split on the pipe → two parsed lines.
 */
import {
  checkoutRef,
  groupCheckouts,
  planShopifyImport,
  type ShopifyRow,
} from "../lib/shopify-checkouts.ts";
import { parseProductText, type ParserMasters } from "../lib/product-parser.ts";

const SM =
  "CA Inter SM Full Course By CA Rishabhh Jainn - Google Drive With Hard Copy / 1.7 Times / 12 Months / Jan 27 (March 2026 Recording)";
const COSTING =
  "CA Inter Costing Full Course By CA Namit Arora - Google Drive with Hard Copy / 6 Months / Jan-27";

/** The real shape of rows 5 and 6 of the 17-18 Sep export. */
const rows: ShopifyRow[] = [
  {
    rowNumber: 5,
    raw: {
      Name: "#38732552601687",
      Id: "38732552601687",
      Email: "priyanandan237@gmail.com",
      "Created at": "2026-09-17 11:33:34 +0530",
      "Billing Name": "Priya Nandan",
      "Billing Phone": "08527799484",
      "Shipping Phone": "08527799484",
      Phone: "",
      "Lineitem name": SM,
      Vendor: "CA Rishabhh Jainn",
    },
  },
  {
    // The continuation row: same checkout, no Id, only the "#" Name.
    rowNumber: 6,
    raw: {
      Name: "#38732552601687",
      Id: "",
      Email: "priyanandan237@gmail.com",
      "Created at": "2026-09-17 11:33:34 +0530",
      "Billing Name": "",
      "Billing Phone": "",
      "Shipping Phone": "",
      Phone: "",
      "Lineitem name": COSTING,
      Vendor: "CA Namit Arora",
    },
  },
];

const masters: ParserMasters = {
  courses: [{ id: "c-inter", name: "CA Inter" }],
  subjects: [
    { id: "s-sm", name: "FM SM", course_id: "c-inter" },
    { id: "s-cost", name: "Costing", course_id: "c-inter" },
  ],
  contents: [{ id: "ct-full", name: "Full" }],
  terms: [{ id: "t-jan27", name: "Jan-27" }],
  teachers: [
    { id: "t-rishabh", name: "Rishabh Jain" },
    { id: "t-namit", name: "Namit Arora" },
  ],
};

let passed = 0;
const failures: string[] = [];
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed += 1;
  else failures.push(`${name}\n    want ${w}\n    got  ${g}`);
}

check(
  "the continuation row keys to the same checkout",
  checkoutRef(rows[1].raw, 6),
  checkoutRef(rows[0].raw, 5),
);

const checkouts = groupCheckouts(rows);
check("two line items make one checkout", checkouts.length, 1);
check("both line items are on it", checkouts[0].rowNumbers, [5, 6]);
check(
  "the titles are joined with a pipe",
  checkouts[0].productText,
  `${SM} | ${COSTING}`,
);
check(
  "the phone comes off the row that has one",
  checkouts[0].phone.mobile,
  "8527799484",
);
check("the name comes off the row that has one", checkouts[0].name, "Priya Nandan");

const plan = planShopifyImport(rows, new Set());
check("one candidate, not two", plan.candidates.length, 1);
check("nothing is held for a missing number", plan.held.length, 0);
check(
  "the candidate carries both products",
  plan.candidates[0].productText.split(" | ").length,
  2,
);

// The end of the chain: what applyAutoInterests would write.
const parsed = parseProductText(plan.candidates[0].productText, masters);
const lines = parsed.flatMap((p) => p.lines);
check("two interest lines on the enquiry", lines.length, 2);
check(
  "one per teacher",
  lines.map((l) => l.teacherId).sort(),
  ["t-namit", "t-rishabh"],
);
check(
  "one per subject",
  lines.map((l) => l.subjectId).sort(),
  ["s-cost", "s-sm"],
);

console.log(`${passed}/${passed + failures.length} passed`);
for (const f of failures) console.error("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
