/**
 * BB's Nov 2026 offer (announced 5 Nov, live on Zeroinfy from 11 PM 5 Nov): BB
 * gives ₹500 off as a coupon on bbvirtuals.com, so Zeroinfy lists BB − ₹500 on
 * batches whose BB price (before the coupon) is ₹3,999 or more. No end date —
 * Rohit says when it ends; then set this to false and Zeroinfy = BB again.
 */
export const OFFER_RULES_ACTIVE = true;

/**
 * Price check: the owner's BB pricing rules as code (keep in step with
 * Settings → Vendors → BB Virtuals instructions and claude/bb-listing-playbook.md).
 *
 * Always:
 *  - CA Karan Kumar's courses and combos: BB − ₹1,000, offer or not (no extra
 *    ₹500) — except the Borana + Karan Kumar DT & Law EO Fast Track combo.
 *  - BB Publication books: same as BB (₹1 below a round figure is fine).
 * During a BB offer (BB price ₹3,999 or more): BB − ₹500, except — same as BB —
 *  - CA Mohnish Vora's, CA Vishal Bhattad's, CA Tharun Raj's, CA Shivangi
 *    Agrawal's own courses; CA Rajkumar's own GST; CA Amit Mahajan's CA/CMA
 *    Inter Taxation (DT + GST) Practice Batch; CA Arjun Chhabra's own courses
 *    above CA Foundation; BB Prep Tests; ACCA; books; "Copy From Center".
 *  Combos of these faculties with others do get the ₹500 (e.g. Borana +
 *  Bhattad, Borana + Rajkumar, Arjun Chhabra combos).
 *  - CA Inter Both Group combos priced at BB's combo coupon (BGCOMBO ₹45,000).
 * Within ₹1 of the rule is fine (₹32,000 for ₹31,999).
 */

const FACULTY = [
  "aakash kandoi", "shubham keswani", "bhanwar borana", "sankalp kanstiya", "amit mahajan", "mohnish vora",
  "vishal bhattad", "siddhesh valimbe", "tharun raj", "rajkumar", "shivam mishra", "karan kumar", "arjun chhabra",
  "sanjay appan", "shyam soni", "yogesh patil", "deep koradia", "hardik manchanda", "akash agrawal",
  "shivangi agrawal", "satish jalan", "harsh gupta", "aagam dalal", "biplab mondal", "akshansh garg",
];

export function facultiesIn(title: string): string[] {
  const t = title.toLowerCase().replace(/mvsir/g, "mohnish vora").replace(/karan sir/g, "karan kumar");
  return FACULTY.filter((f) => t.includes(f));
}

export type Expected = { price: number; rule: string };

/** Listings with their own agreed price (Shopify product id → price, why). */
const FIXED: Record<number, Expected> = {
  7595162435671: { price: 45000, rule: "CA Inter Both Group combo: BB's BGCOMBO coupon price" },
  7857874960471: { price: 45000, rule: "CA Inter Both Group combo: BB's BGCOMBO coupon price" },
};
/** Karan Kumar listings that follow the normal BB rule instead of − ₹1,000. */
const KARAN_NORMAL = new Set([7598885929047]);

export function expectedZeroinfyPrice(vendorPrice: number, zeroinfyTitle: string, vendorName = "BB Virtuals", productId?: number): Expected {
  // Vsmart: the price after its automatic coupon, no other rule (decided 22 Oct 2026).
  if (/vsmart/i.test(vendorName)) return { price: vendorPrice, rule: "Same as Vsmart (after its auto coupon)" };
  if (productId != null && FIXED[productId]) return FIXED[productId];
  if (/publication|books/i.test(vendorName)) return { price: vendorPrice, rule: "BB book: same as BB Publication" };

  const f = facultiesIn(zeroinfyTitle);
  const t = zeroinfyTitle.toLowerCase();
  if (f.includes("karan kumar") && !(productId != null && KARAN_NORMAL.has(productId))) {
    return { price: vendorPrice - 1000, rule: "CA Karan Kumar: BB − ₹1,000" };
  }
  if (!OFFER_RULES_ACTIVE) return { price: vendorPrice, rule: "Same as BB" };
  if (vendorPrice < 3999) return { price: vendorPrice, rule: "Below ₹3,999: no BB offer, same as BB" };

  const same = (why: string): Expected => ({ price: vendorPrice, rule: `${why}: no BB offer, same as BB` });
  if (/acca/.test(t)) return same("ACCA");
  if (/prep ?test/.test(t)) return same("BB Prep Test");
  if (/copy from center/.test(t)) return same("Copy From Center");
  if (/books?|book set/.test(t) && !/course|batch|lecture|class/.test(t)) return same("Book");
  // "Own course" = a single-faculty listing; anything sold as a combo or "By BB Virtuals" is a combo.
  const combo = /combo|bb virtual/.test(t) || f.length > 1;
  const only = (name: string) => !combo && f.length > 0 && f.every((x) => x === name);
  if (only("mohnish vora")) return same("CA Mohnish Vora's own course");
  if (only("vishal bhattad")) return same("CA Vishal Bhattad's own course");
  if (only("tharun raj")) return same("CA Tharun Raj's own course");
  if (only("shivangi agrawal")) return same("CA Shivangi Agrawal's own course");
  if (only("rajkumar") && /gst|idt|indirect/.test(t)) return same("CA Rajkumar's own GST");
  if (only("arjun chhabra") && !/foundation/.test(t)) return same("CA Arjun Chhabra's own course (offer is CA Foundation only)");
  if (only("amit mahajan") && /practice/.test(t) && /(taxation|income tax).*(gst|idt)|dt.*gst/.test(t)) {
    return same("CA Amit Mahajan Taxation Practice Batch");
  }
  return { price: vendorPrice - 500, rule: "BB offer: BB − ₹500" };
}

/** True when the Zeroinfy price is within ₹1 of the rule. */
export function priceOk(zeroinfy: number, expected: number): boolean {
  return Math.abs(zeroinfy - expected) <= 1;
}
