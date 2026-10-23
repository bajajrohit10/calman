/**
 * Price check: the owner's BB pricing rules (Settings → Vendors → BB Virtuals
 * instructions, Oct 2026 offer) as code. Keep in step with that text.
 *
 *  - Zeroinfy = BB − ₹500.
 *  - At ₹4,000 or below: Zeroinfy = BB.
 *  - CA Mohnish Vora's own courses: BB price (combos with others: − ₹500).
 *  - CA Vishal Bhattad's own courses: BB price (combos with others: − ₹500).
 *  - CA Karan Kumar's own courses: BB − ₹1,000.
 *  - CA Amit Mahajan CA/CMA Inter Taxation (DT + GST) Practice Batch: BB price.
 *  - Within ₹1 of the rule is fine (₹32,000 for ₹31,999).
 */

const FACULTY = [
  "aakash kandoi", "shubham keswani", "bhanwar borana", "sankalp kanstiya", "amit mahajan", "mohnish vora",
  "vishal bhattad", "siddhesh valimbe", "tharun raj", "rajkumar", "shivam mishra", "karan kumar", "arjun chhabra",
  "sanjay appan", "shyam soni", "yogesh patil", "deep koradia", "hardik manchanda", "akash agrawal",
  "shivangi agrawal", "satish jalan", "harsh gupta", "aagam dalal", "biplab mondal",
];

export function facultiesIn(title: string): string[] {
  const t = title.toLowerCase().replace(/mvsir/g, "mohnish vora").replace(/karan sir/g, "karan kumar");
  return FACULTY.filter((f) => t.includes(f));
}

export type Expected = { price: number; rule: string };

export function expectedZeroinfyPrice(vendorPrice: number, zeroinfyTitle: string): Expected {
  if (vendorPrice <= 4000) return { price: vendorPrice, rule: "₹4,000 or below: same as BB" };
  const f = facultiesIn(zeroinfyTitle);
  const only = (name: string) => f.length > 0 && f.every((x) => x === name);
  const t = zeroinfyTitle.toLowerCase();
  if (only("mohnish vora")) return { price: vendorPrice, rule: "CA Mohnish Vora's own course: same as BB" };
  if (only("vishal bhattad")) return { price: vendorPrice, rule: "CA Vishal Bhattad's own course: same as BB" };
  if (only("karan kumar")) return { price: vendorPrice - 1000, rule: "CA Karan Kumar's course: BB − ₹1,000" };
  if (only("amit mahajan") && /practice/.test(t) && /(taxation|income tax).*(gst|idt)|dt.*gst/.test(t)) {
    return { price: vendorPrice, rule: "CA Amit Mahajan Taxation Practice Batch: same as BB" };
  }
  return { price: vendorPrice - 500, rule: "BB − ₹500" };
}

/** True when the Zeroinfy price is within ₹1 of the rule. */
export function priceOk(zeroinfy: number, expected: number): boolean {
  return Math.abs(zeroinfy - expected) <= 1;
}
