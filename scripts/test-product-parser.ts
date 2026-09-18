/**
 * §55.1. The parser's own tests, run with node's native TypeScript stripping:
 *
 *   node --experimental-strip-types scripts/test-product-parser.ts
 *
 * lib/product-parser.ts is a pure module with no imports of its own, which is
 * what makes this possible without a test runner or a bundler. The masters are
 * a fixture rather than the real lists: a test that reads production data
 * fails when somebody adds a teacher, which teaches everyone to ignore it.
 */
import {
  parseProductText,
  splitProducts,
  type ParserMasters,
} from "../lib/product-parser.ts";

const masters: ParserMasters = {
  courses: [
    { id: "c-final", name: "CA Final" },
    { id: "c-inter", name: "CA Inter" },
  ],
  subjects: [
    { id: "s-fr", name: "FR", course_id: "c-final" },
    { id: "s-idt", name: "Indirect Tax", course_id: "c-final" },
    { id: "s-costing", name: "Costing", course_id: "c-inter" },
  ],
  contents: [
    { id: "ct-full", name: "Full" },
    { id: "ct-books", name: "Books" },
  ],
  terms: [{ id: "t-nov26", name: "Nov-26" }],
  teachers: [
    { id: "t-kandoi", name: "Aakash Kandoi" },
    { id: "t-bhattad", name: "Vishal Bhattad" },
    { id: "t-arora", name: "Namit Arora" },
  ],
  institutes: [
    { id: "i-vsmart", name: "Vsmart Academy", teacherIds: ["t-bhattad"] },
    { id: "i-many", name: "Big House", teacherIds: ["t-kandoi", "t-arora"] },
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

/* ---- the pipe, which is the whole reason this file exists ---------------- */

const twoTitles =
  "CA Final Financial Reporting (FR) Regular Batch By CA Aakash Kandoi" +
  " | " +
  "CA Final Indirect Tax (IDT) Full Course By CA Vishal Bhattad";

check("pipe splits into two products", splitProducts(twoTitles).length, 2);

const joined = parseProductText(twoTitles, masters);
check("two products parsed", joined.length, 2);
check(
  "two interest lines, one per title",
  joined.flatMap((p) => p.lines).length,
  2,
);
check(
  "each line keeps its own teacher",
  joined.flatMap((p) => p.lines.map((l) => l.teacherId)).sort(),
  ["t-bhattad", "t-kandoi"],
);

/* ---- the old comma rule still works, inside a piped piece --------------- */

check(
  "comma rule survives the pipe",
  splitProducts(
    "CA Inter Costing By CA Namit Arora, CA Final FR By CA Aakash Kandoi | CA Final Indirect Tax By CA Vishal Bhattad",
  ).length,
  3,
);
check("a title with no pipe is one product", splitProducts("CA Final FR Full").length, 1);
check("commas inside one title do not split it", splitProducts("CA Final FR, IDT Full").length, 1);

/* ---- the Vendor hint ---------------------------------------------------- */

const noTeacher = "CA Final Financial Reporting (FR) Regular Batch - Google Drive";
check(
  "no teacher in the title, and no hint",
  parseProductText(noTeacher, masters)[0].lines.map((l) => l.teacherId),
  [null],
);
check(
  "hint fills the gap when the title names nobody",
  parseProductText(noTeacher, masters, { teacherHint: "Aakash Kandoi" })[0].lines.map(
    (l) => l.teacherId,
  ),
  ["t-kandoi"],
);
check(
  "an institute with one teacher resolves",
  parseProductText(noTeacher, masters, { teacherHint: "Vsmart Academy" })[0].lines.map(
    (l) => l.teacherId,
  ),
  ["t-bhattad"],
);
check(
  "an institute with several teachers resolves to none",
  parseProductText(noTeacher, masters, { teacherHint: "Big House" })[0].lines.map(
    (l) => l.teacherId,
  ),
  [null],
);
check(
  "the scan wins over the hint",
  parseProductText(
    "CA Final FR Regular Batch By CA Aakash Kandoi",
    masters,
    { teacherHint: "Vsmart Academy" },
  )[0].lines.map((l) => l.teacherId),
  ["t-kandoi"],
);
check(
  "an unknown vendor changes nothing",
  parseProductText(noTeacher, masters, { teacherHint: "Some Shop" })[0].lines.map(
    (l) => l.teacherId,
  ),
  [null],
);

/* ------------------------------------------------------------------------- */

console.log(`${passed}/${passed + failures.length} passed`);
for (const f of failures) console.error("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
