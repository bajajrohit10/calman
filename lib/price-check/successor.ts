/**
 * Price check: "BB moved this course to a new page".
 *
 * BB doesn't change a product's attempt in place: for a new attempt it publishes
 * a new product page (new link) and takes the old one down. Calman watches the
 * old link, so the course looks "dropped". This finds the page that replaced it
 * in the vendor's public product list, by what the course is (level, subjects,
 * faculty, Regular / Exam Oriented / Practice, Hindi / English), never by price.
 *
 * Owner, 18 Nov 2026: a dropped Nov 26 page whose course BB now sells for
 * May 27 → replace the attempt on Zeroinfy; no such page → the listing goes
 * (the team confirms with BB first).
 */

export type FeedItem = { title: string; url_slug: string; selling_price: number | null; mrp_price: number | null };

export type Successor = { slug: string; title: string; price: number | null; mrp: number | null; score: number; sure: boolean; why: string };

const FACULTY = [
  "kandoi", "keswani", "borana", "kanstiya", "valimbe", "bhattad", "tharun", "rajkumar", "mahajan", "chhabra",
  "karan", "mohnish", "appan", "patil", "mishra", "saraf", "koradia", "soni", "jalan", "sureka", "agrawal", "garg",
];
/** Faculties that teach a subject others also teach: a different one means a different course. */
const DISTINCT = new Set(["kanstiya", "mishra", "mohnish", "appan", "patil", "soni", "tharun", "rajkumar", "bhattad", "valimbe", "karan", "chhabra", "mahajan", "saraf"]);

type Sig = { level: string; subjects: string; faculty: Set<string>; english: boolean; type: string; attempts: string[] };

const norm = (s: string) => ` ${s.toLowerCase().replace(/mvsir/g, "mohnish vora").replace(/[^a-z0-9]+/g, " ")} `;

export function courseSignature(text: string): Sig {
  const s = norm(text);
  const level = / cma /.test(s) && / final /.test(s) ? "cma-final" : / cma /.test(s) && / inter /.test(s) ? "cma-inter" : / final /.test(s) ? "final" : / inter /.test(s) ? "inter" : / foundation /.test(s) ? "foundation" : "?";
  const sub = new Set<string>();
  const add = (re: RegExp, k: string) => {
    if (re.test(s)) sub.add(k);
  };
  add(/ fr | financial reporting /, "fr");
  add(/ afm | advanced financial management | sfm /, "afm");
  add(/ audit| auditing /, "audit");
  add(/ dt | direct tax| direct and indirect tax/, "dt");
  add(/ idt | indirect tax/, "idt");
  add(/ gst /, "gst");
  add(/ taxation /, "tax");
  add(/ law | laws | corporate and other law/, "law");
  add(/ adv | advanced accounting| advanced accounts| accounts /, "acc");
  add(/ cost | costing | cost and management/, "cost");
  add(/ fm sm | fm and sm /, "fmsm");
  add(/ fm | financial management/, "fm");
  add(/ sm | strategic management/, "sm");
  add(/ scpm | spom | set b /, "scpm");
  add(/ all subjects /, "all");
  add(/ both group /, "both");
  add(/ group1 | group 1 /, "g1");
  add(/ group 2 | group2 /, "g2");
  if (sub.has("fmsm")) {
    sub.add("fm");
    sub.add("sm");
    sub.delete("fmsm");
  }
  if (sub.has("tax")) {
    sub.add("dt");
    sub.add(level.endsWith("inter") ? "gst" : "idt");
    sub.delete("tax");
  }
  if (level.endsWith("inter") && sub.has("idt")) {
    sub.delete("idt");
    sub.add("gst");
  }
  const faculty = new Set(FACULTY.filter((f) => s.includes(` ${f} `) || s.includes(` ${f}`)));
  const type: string[] = [];
  if (/ regular | full course /.test(s)) type.push("reg");
  if (/ exam oriented | fastrack | fast track | ft | eo /.test(s)) type.push("eo");
  if (/ practice /.test(s)) type.push("prac");
  const attempts = [...s.matchAll(/ (jan|may|jun|june|sep|nov|dec) (2\d) /g)].map((m) => `${m[1].slice(0, 3)}${m[2]}`);
  return { level, subjects: [...sub].sort().join(","), faculty, english: / english /.test(s), type: type.sort().join(","), attempts };
}

/**
 * Pages in the vendor's product list that sell the same course as `zeroinfyTitle`
 * (the old page's title/slug add detail), best first. `sure` when there is one
 * clear candidate with the same type and a current attempt.
 */
export function findSuccessors(feed: FeedItem[], zeroinfyTitle: string, oldTitle: string | null, oldSlug: string): Successor[] {
  const want = courseSignature(`${zeroinfyTitle} ${oldTitle ?? ""} ${oldSlug.replace(/-/g, " ")}`);
  // Subjects/type from the Zeroinfy title alone are the most reliable; fall back to the combined text.
  const z = courseSignature(zeroinfyTitle);
  const subjects = z.subjects || want.subjects;
  const type = z.type || want.type;
  const out: Successor[] = [];
  for (const p of feed) {
    if (!p.url_slug || p.url_slug === oldSlug || !(Number(p.selling_price) > 0)) continue;
    const g = courseSignature(`${p.title} ${p.url_slug.replace(/-/g, " ")}`);
    if (g.level !== want.level || g.subjects !== subjects || g.english !== want.english) continue;
    // Faculty: every one the listing names must be on the page if the page names any; no other "distinct" faculty.
    if (g.faculty.size && [...want.faculty].some((f) => !g.faculty.has(f))) continue;
    if ([...g.faculty].some((f) => DISTINCT.has(f) && want.faculty.size > 0 && !want.faculty.has(f))) continue;
    let score = 0;
    const why: string[] = [];
    if (g.type === type) {
      score += 3;
    } else if (g.type.split(",").some((k) => k && type.includes(k))) {
      score += 1;
      why.push("batch type differs");
    } else {
      continue;
    }
    if (g.attempts.some((a) => /27|28|29/.test(a))) score += 2;
    if (g.attempts.length && g.attempts.every((a) => /26/.test(a))) {
      score -= 3;
      why.push("old attempt");
    }
    out.push({ slug: p.url_slug, title: p.title, price: p.selling_price, mrp: p.mrp_price, score, sure: false, why: why.join(", ") });
  }
  out.sort((a, b) => b.score - a.score);
  const top = out.filter((c) => c.score >= 5);
  if (top.length === 1) top[0].sure = true;
  return out.slice(0, 3);
}

/** The vendor's public product list (course-platform sites). */
export async function readEdportalFeed(platformKey: string): Promise<FeedItem[]> {
  const res = await fetch(
    `https://data.edportal.in/api/v1/products/${encodeURIComponent(platformKey)}/storefront/product/store-list?status__in=published&product_type__in=public&count=1000`,
    { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) throw new Error(`The vendor's product list answered HTTP ${res.status}.`);
  const body = (await res.json().catch(() => null)) as { apiSuccess?: boolean; data?: FeedItem[] } | null;
  if (!body?.apiSuccess || !Array.isArray(body.data)) throw new Error("The vendor's product list did not come back as expected.");
  return body.data;
}
