import { attemptHasPassed } from "@/lib/price-check/batch-dates";

/**
 * Price check: adding a later (or other) attempt that BB sells as a separate
 * product, automatically, when there's no doubt:
 *  - the Zeroinfy listing has one option that holds the attempt ("Jan 27",
 *    "May-27", "May 27 and onwards (Oct 2026 Batch)");
 *  - every variant of one existing attempt is linked (approved) to BB;
 *  - for each of those variants, BB's product for the new attempt has exactly
 *    one live option with the same name (ignoring "Exam: …").
 * Then the new attempt's variants copy the existing ones, priced at BB's price.
 * Anything else is left to a person, with the reason.
 */

const MON = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const ATT = new RegExp(`^(${MON})[a-z]*([\\s-]*)(\\d\\d|20\\d\\d)\\b(.*)$`, "i");

export type PlanLink = {
  shopify_variant_id: number;
  shopify_variant_title: string | null;
  status: string;
  vendor_product_slug: string | null;
  vendor_variant_id: string | null;
  vendor_variant_label: string | null;
  keep_price: boolean;
};
export type PlanOption = { variant_id: string; label: string; price: number | null; state: string };
export type AttemptPlan =
  | { ok: true; attemptIndex: number; baseValue: string; newValue: string; items: { baseVariantId: number; newTitle: string; vendorVariantId: string; vendorLabel: string; price: number }[] }
  | { ok: false; why: string };

const parts = (s: string | null) => (s ?? "").split(/,\s*(?=[A-Za-z .&/()-]+:)/).map((p) => p.trim());
const core = (label: string | null) =>
  parts(label)
    .filter((p) => !/^(exam|exams|attempt)\s*:/i.test(p))
    .map((p) => p.replace(/\s+/g, " ").toLowerCase())
    .sort()
    .join(" | ");

export function planAttempt(links: PlanLink[], bbAttempts: string | null, bbOptions: PlanOption[]): AttemptPlan {
  const ls = links.filter((l) => l.status !== "rejected" && l.shopify_variant_title);
  if (!ls.length) return { ok: false, why: "No variants on Zeroinfy." };
  const segs = ls.map((l) => l.shopify_variant_title!.split(" / ").map((s) => s.trim()));
  const n = segs[0].length;
  if (segs.some((s) => s.length !== n)) return { ok: false, why: "Variants don't share one option layout." };
  const idx = [...Array(n).keys()].find((i) => segs.every((s) => ATT.test(s[i])));
  if (idx == null) return { ok: false, why: "No option on Zeroinfy holds just the attempt." };

  const m = (bbAttempts ?? "").match(new RegExp(`(${MON})[a-z]*\\s*'?(\\d\\d)`, "i"));
  if (!m) return { ok: false, why: "BB's attempt for this product is unclear." };
  const mon = m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase();

  const byValue = new Map<string, PlanLink[]>();
  ls.forEach((l, i) => (byValue.get(segs[i][idx]) ?? byValue.set(segs[i][idx], []).get(segs[i][idx])!).push(l));
  const bases = [...byValue.entries()].filter(
    ([, xs]) => xs.every((x) => x.status === "approved" && x.vendor_variant_id && !x.keep_price) && new Set(xs.map((x) => x.vendor_product_slug)).size === 1,
  );
  if (!bases.length) return { ok: false, why: "Confirm this listing's BB links first (steps 1–4); then it can copy an attempt." };
  const [baseValue, base] = bases.sort((a, b) => b[1].length - a[1].length)[0];

  const bm = baseValue.match(ATT)!;
  let rest = bm[4];
  if (/(and|&)\s*onwards/i.test(rest) && !/onwards/i.test(bbAttempts ?? "")) rest = rest.replace(/\s*(and|&)\s*onwards/i, "");
  const newValue = `${mon}${bm[2].includes("-") ? "-" : " "}${m[2]}${rest}`.trim();
  if (byValue.has(newValue)) return { ok: false, why: `"${newValue}" is already on Zeroinfy.` };
  if (attemptHasPassed(newValue)) return { ok: false, why: `${newValue} has passed.` };

  const live = bbOptions.filter((o) => o.state === "live" && Number(o.price ?? 0) > 0);
  const items: Extract<AttemptPlan, { ok: true }>["items"] = [];
  for (const b of base) {
    const c = live.filter((o) => core(o.label) === core(b.vendor_variant_label));
    if (c.length !== 1) return { ok: false, why: `BB's ${bbAttempts} product has ${c.length ? "several options" : "no option"} like “${b.vendor_variant_label}”.` };
    const t = b.shopify_variant_title!.split(" / ");
    t[idx] = newValue;
    items.push({ baseVariantId: Number(b.shopify_variant_id), newTitle: t.join(" / "), vendorVariantId: c[0].variant_id, vendorLabel: c[0].label, price: Number(c[0].price) });
  }
  return { ok: true, attemptIndex: idx, baseValue, newValue, items };
}
