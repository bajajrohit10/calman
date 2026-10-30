import type { EdportalVariant } from "@/lib/price-check/edportal";

/**
 * Price check: turning BB options into a Zeroinfy listing's own option layout.
 *
 * Zeroinfy listings are laid out as
 *   1. Mode of Delivery (Google Drive / Mobile App / Pen Drive with Hard Copy …)
 *   2. Attempt (May 27, Nov 27 …)
 *   3. Batch recording(s) — for a combo where one subject's batch varies and the
 *      other's doesn't, the varying subject gets its own option ("IDT Batch").
 *
 * A BB option the listing doesn't sell is drafted by taking the closest BB option
 * the listing already sells (same course, fewest differences), keeping that
 * Zeroinfy variant's values, and swapping in only what differs. A difference that
 * no Zeroinfy option holds becomes a new option, placed where Zeroinfy keeps it.
 * Everything is a draft: the person edits it before anything goes to Shopify.
 *
 * Pure (no server code), so the panel can redraft as the person edits.
 */

export type OptionClass = "mode" | "attempt" | "batch";

const MON = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const MODE_NAME = /mode|delivery|medium|format|device|platform/i;
const MODE_VALUE = /google\s*drive|\bgd\b|mobile\s*app|pen\s*drive|\busb\b|laptop|android|\bios\b|windows|hard\s*copy|live\s*(batch|class|stream)|e-?book/i;
const ATTEMPT_NAME = /attempt|exam/i;
const ATTEMPT_VALUE = new RegExp(`^(${MON})[a-z]*[\\s'-]*(\\d\\d|20\\d\\d)\\b`, "i");

export function classifyName(name: string): OptionClass | null {
  if (MODE_NAME.test(name)) return "mode";
  if (ATTEMPT_NAME.test(name)) return "attempt";
  if (/batch|record|lecture|faculty|version|subject/i.test(name)) return "batch";
  return null;
}

function classifyValue(value: string): OptionClass | null {
  if (MODE_VALUE.test(value)) return "mode";
  if (ATTEMPT_VALUE.test(value.trim())) return "attempt";
  return null;
}

/** A Zeroinfy option's role, from its name, else from its values. */
export function classifyOption(o: { name: string; values: string[] }): OptionClass {
  const byName = classifyName(o.name);
  if (byName) return byName;
  const cls = o.values.map(classifyValue);
  if (cls.length && cls.every((c) => c === "mode")) return "mode";
  if (cls.length && cls.every((c) => c === "attempt")) return "attempt";
  return "batch";
}

/** "FR: Batch 2 - Jan 26 Recordings" → ["FR", "Batch 2 - Jan 26 Recordings"]. */
export function splitOpt(o: string): [string, string] {
  const i = o.indexOf(": ");
  return i < 0 ? ["", o.trim()] : [o.slice(0, i).trim(), o.slice(i + 2).trim()];
}

const parse = (v: EdportalVariant) => new Map(v.options.map(splitOpt).filter(([k]) => k));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type ZOption = { name: string; values: string[] };
export type ZVariant = { id: number; selected: Record<string, string> };
export type ZLink = { shopify_variant_id: number; vendor_product_slug: string | null; vendor_variant_id: string | null };

export type NewOption = {
  /** BB option this comes from, e.g. "IDT". */
  key: string;
  name: string;
  /** 1-based position in the final layout. */
  position: number;
  /** What every current variant is called in the new option. */
  currentValue: string;
};

export type DraftRow = {
  vendorVariantId: string;
  vendorVariantLabel: string;
  /** Every option of the final layout (current + new) → value. */
  options: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  /** Where the draft is unsure, for the person to check. */
  notes: string[];
};

export type Draft = { newOptions: NewOption[]; rows: DraftRow[] };

type Ctx = {
  options: ZOption[];
  variants: ZVariant[];
  /** Links of this listing to every vendor product (the base is looked for in `slug` first). */
  links: ZLink[];
  /** Every vendor product in the panel, by slug. */
  vendorVariants: Map<string, EdportalVariant[]>;
  slug: string;
  /** Set when the vendor product is the same course for another attempt ("May 27"). */
  attempt: string | null;
};

type Base = { bb: Map<string, string>; z: ZVariant } | null;

/** The sold BB option closest to `gap` (fewest differing options), and the Zeroinfy variant linked to it. */
function findBase(ctx: Ctx, gap: EdportalVariant): Base {
  const g = parse(gap);
  const zById = new Map(ctx.variants.map((v) => [v.id, v]));
  let best: { bb: Map<string, string>; z: ZVariant; d: number; same: boolean } | null = null;
  for (const l of ctx.links) {
    if (!l.vendor_product_slug || !l.vendor_variant_id) continue;
    const z = zById.get(Number(l.shopify_variant_id));
    const bbv = ctx.vendorVariants.get(l.vendor_product_slug)?.find((x) => x.id === l.vendor_variant_id);
    if (!z || !bbv) continue;
    const bb = parse(bbv);
    const keys = new Set([...g.keys(), ...bb.keys()]);
    let d = 0;
    for (const k of keys) if (norm(g.get(k) ?? "") !== norm(bb.get(k) ?? "")) d++;
    const same = l.vendor_product_slug === ctx.slug;
    // Same vendor product first, then fewest differences.
    if (!best || (same && !best.same) || (same === best.same && d < best.d)) best = { bb, z, d, same };
  }
  return best ? { bb: best.bb, z: best.z } : null;
}

/** An existing value of `o` that is the same as `v`, else null. */
function existing(o: ZOption, v: string): string | null {
  const n = norm(v);
  return o.values.find((x) => norm(x) === n) ?? null;
}

/** The Zeroinfy option that holds BB option `key` (whose sold value was `was`). */
function targetOption(ctx: Ctx, base: Base, key: string, was: string, now: string): ZOption | null {
  const cls = classifyName(key) ?? classifyValue(now) ?? classifyValue(was);
  const zv = base?.z.selected ?? {};
  // A Zeroinfy value that contains the old BB text is the surest sign.
  if (was) {
    const holds = ctx.options.filter((o) => zv[o.name] && norm(zv[o.name]).includes(norm(was)));
    if (holds.length === 1) return holds[0];
  }
  const sameClass = ctx.options.filter((o) => classifyOption(o) === (cls ?? "batch"));
  if (sameClass.length === 1) return sameClass[0];
  if (sameClass.length > 1) {
    // e.g. key "IDT" → option "IDT Batch".
    const ks = subjectWords(key);
    return sameClass.find((o) => norm(o.name).split(" ").some((w) => ks.includes(w))) ?? null;
  }
  return null;
}

const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** BB names subjects in full ("Indirect Tax"); Zeroinfy options often use the short form ("IDT"). */
const SUBJECT_SHORT: Record<string, string> = {
  "direct tax": "dt",
  "direct taxes": "dt",
  "income tax": "dt",
  "indirect tax": "idt",
  "indirect taxes": "idt",
  gst: "idt",
  "financial reporting": "fr",
  "strategic financial management": "sfm",
  "advanced financial management": "afm",
  "advanced auditing": "audit",
  auditing: "audit",
  "corporate law": "law",
  "corporate laws": "law",
  "cost and management accounting": "cost",
  "financial management": "fm",
  "strategic management": "sm",
  "integrated business solutions": "ibs",
};
function subjectWords(key: string): string[] {
  const n = norm(key);
  const out = [n.split(" ")[0], n.replace(/ /g, "")];
  if (SUBJECT_SHORT[n]) out.push(SUBJECT_SHORT[n]);
  return out;
}

function newOptionName(key: string) {
  const short = SUBJECT_SHORT[norm(key)];
  const k = short ? short.toUpperCase() : key.trim() || "Batch";
  return /batch|record|attempt|mode|delivery/i.test(k) ? title(k) : `${k} Batch`;
}

/** The value for option `o` when BB's `was` becomes `now`: swap just that text when the value contains it. */
function swap(o: ZOption, current: string | undefined, was: string, now: string): string {
  const hit = existing(o, now);
  if (hit) return hit;
  if (current && was) {
    const i = current.toLowerCase().indexOf(was.toLowerCase());
    if (i >= 0) return current.slice(0, i) + now + current.slice(i + was.length);
  }
  return now;
}

function rowFor(ctx: Ctx, gap: EdportalVariant, newOptions: NewOption[]): DraftRow {
  const g = parse(gap);
  const base = findBase(ctx, gap);
  const notes: string[] = [];
  const out: Record<string, string> = {};
  for (const o of ctx.options) out[o.name] = base?.z.selected[o.name] ?? o.values[0] ?? "";
  if (!base) notes.push("Nothing on this listing is linked to BB yet — check every value.");

  const taken = new Set<string>();
  for (const [k, now] of g) {
    const was = base?.bb.get(k) ?? "";
    if (base && norm(was) === norm(now)) continue;
    if (newOptions.some((n) => n.key === k)) continue;
    if (/^(exam|exams)$/i.test(k)) continue; // BB's "Exam:" is the attempt, read below.
    const o = targetOption(ctx, base, k, was, now);
    if (!o) {
      notes.push(`BB's “${k}: ${now}” has no place on this listing.`);
      continue;
    }
    if (taken.has(o.name)) {
      out[o.name] = `${out[o.name]} | ${now}`;
      notes.push(`${o.name} holds two BB options — check the name.`);
    } else out[o.name] = swap(o, out[o.name], was, now);
    taken.add(o.name);
  }
  // Another attempt sold as its own BB product.
  if (ctx.attempt) {
    const att = ctx.options.find((o) => classifyOption(o) === "attempt");
    const m = ctx.attempt.match(new RegExp(`(${MON})[a-z]*[\\s'-]*(\\d\\d)`, "i"));
    if (att && m) {
      const mon = m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase();
      const cur = out[att.name] ?? "";
      const sep = /^[a-z]+-\d/i.test(cur) ? "-" : " ";
      const v = `${mon}${sep}${m[2]}`;
      const cm = cur.match(ATTEMPT_VALUE);
      out[att.name] = existing(att, v) ?? (cm ? v + cur.slice(cm[0].length) : v);
    } else if (!att) notes.push(`This is BB's ${ctx.attempt} product, but the listing has no Attempt option.`);
  }
  for (const n of newOptions) out[n.name] = g.get(n.key) ?? n.currentValue;

  const price = Number(gap.price ?? 0);
  const mrp = gap.mrp == null ? null : Number(gap.mrp);
  return {
    vendorVariantId: gap.id,
    vendorVariantLabel: gap.title,
    options: out,
    price,
    compareAtPrice: mrp != null && mrp > price ? mrp : null,
    notes,
  };
}

/** Where a new option of class `cls` goes: Mode first, Attempt next, batches last. */
function positionFor(ctx: Ctx, cls: OptionClass, already: number): number {
  const classes = ctx.options.map(classifyOption);
  if (cls === "mode") return 1;
  if (cls === "attempt") return classes.filter((c) => c === "mode").length + 1;
  return ctx.options.length + already + 1;
}

/** Draft Zeroinfy variants for the BB options `gaps` (the first is the one the person clicked). */
export function draftFromVendor(ctx: Ctx, gaps: EdportalVariant[]): Draft {
  // BB options that differ from the sold base but have no Zeroinfy option → new options.
  const newOptions: NewOption[] = [];
  for (const gap of gaps) {
    const base = findBase(ctx, gap);
    if (!base) continue;
    for (const [k, now] of parse(gap)) {
      const was = base.bb.get(k) ?? "";
      if (norm(was) === norm(now) || /^(exam|exams)$/i.test(k)) continue;
      if (newOptions.some((n) => n.key === k)) continue;
      if (targetOption(ctx, base, k, was, now)) continue;
      if (ctx.options.length + newOptions.length >= 3) continue; // Shopify's limit; the row notes it.
      const cls = classifyName(k) ?? classifyValue(now) ?? "batch";
      newOptions.push({ key: k, name: newOptionName(k), position: positionFor(ctx, cls, newOptions.length), currentValue: was || "Current batch" });
    }
  }
  newOptions.sort((a, b) => a.position - b.position);
  return { newOptions, rows: gaps.map((g) => rowFor(ctx, g, newOptions)) };
}

/** The final option order once `newOptions` are inserted. */
export function finalLayout(options: ZOption[], newOptions: { name: string; position: number }[]): string[] {
  const names = options.map((o) => o.name);
  for (const n of [...newOptions].sort((a, b) => a.position - b.position)) names.splice(Math.min(n.position - 1, names.length), 0, n.name);
  return names;
}
