import "server-only";

import { fetchAllRows } from "@/lib/paged";
import { OPTION_TYPES, optionType } from "@/lib/price-check/option-types";
import { planAttempt, type AttemptPlan } from "@/lib/price-check/attempt-plan";
import { attemptHasPassed, covers, fmtDates, vendorBatchDates, vendorBooks, withoutBooksPart, ziBatchDates, ziBooks } from "@/lib/price-check/batch-dates";
import { expectedZeroinfyPrice, priceOk } from "@/lib/price-check/rules";
import type { createClient } from "@/lib/supabase/server";

/**
 * Price check: the "To do on Zeroinfy" list, computed from stored data
 * (links + last-read Shopify prices, vendor_options snapshot, sibling vendor
 * products, attempt alternatives, "we don't sell this" decisions).
 */

type Supa = Awaited<ReturnType<typeof createClient>>;

type Link = {
  id: string;
  shopify_product_id: number;
  shopify_variant_id: number;
  shopify_product_title: string;
  shopify_product_handle: string | null;
  shopify_variant_title: string | null;
  vendor_site_id: string;
  vendor_product_slug: string | null;
  vendor_product_title: string | null;
  vendor_variant_id: string | null;
  vendor_variant_label: string | null;
  status: string;
  reason: string | null;
  shopify_price: number | null;
  shopify_compare_at: number | null;
  keep_price: boolean;
};
type Opt = { vendor_site_id: string; product_slug: string; product_title: string | null; variant_id: string; label: string; price: number | null; state: string; last_seen_at: string };
type Sib = { shopify_product_id: number; vendor_site_id: string; product_slug: string; product_title: string | null; attempts: string | null };
type Alt = { shopify_product_id: number; shopify_variant_id: number; vendor_site_id: string; product_slug: string; product_title: string | null; attempts: string | null; vendor_price: number | null; vendor_variant_label: string | null };
type Dec = { shopify_product_id: number; vendor_site_id: string; product_slug: string; variant_id: string };

export type PriceFix = {
  linkId: string;
  variantId: number;
  variantTitle: string;
  current: number;
  compareAt: number | null;
  vendorPrice: number;
  expected: number;
  rule: string;
  vendorLabel: string;
  vendorUrl: string;
  vendorTitle: string | null;
  confirmed: boolean;
};
export type MissingOpt = { siteId: string; slug: string; productTitle: string | null; variantId: string; label: string; price: number | null; expected: number | null };
export type MissingGroup = { siteId: string; siteName: string; siteUrl: string; slug: string; productTitle: string | null; attempts: string | null; kind: "batch" | "attempt"; options: MissingOpt[]; auto: AttemptPlan | null };
export type AttemptChoice = { siteId: string; siteUrl: string; slug: string; productTitle: string | null; attempts: string | null; price: number | null; label: string | null };
/** A linked BB option whose batch dates differ from the Zeroinfy variant's, with the option of the same BB product that matches. */
export type BatchMismatch = { why: "batch" | "books"; linkId: string; variantId: number; variantTitle: string; ziDates: string; currentLabel: string; siteId: string; slug: string; productTitle: string | null; suggestId: string; suggestLabel: string; suggestPrice: number | null };
/** Variants for which several vendor products fit equally; pick one. */
export type AttemptGroup = { variantIds: number[]; variants: { title: string; price: number | null }[]; choices: AttemptChoice[] };

/** A linked vendor option the vendor no longer sells; `replacement` = the live option of the same product that differs in one part only (e.g. the batch). */
export type Dropped = { label: string; variants: number; linkIds: string[]; slug: string; productTitle: string | null; replacement: { id: string; label: string; price: number | null; changed: string } | null };

const parts = (label: string) => label.split(/,\s*(?=[A-Za-z .&/()-]+:)/).map((p) => p.trim().replace(/\s+/g, " "));
const partKey = (p: string) => p.slice(0, Math.max(0, p.indexOf(":"))).trim().toLowerCase();

export type TodoListing = {
  pid: number;
  title: string;
  handle: string | null;
  attemptQuestion: AttemptGroup[] | null;
  confirm: { reasons: string[]; count: number; products: { title: string; url: string }[] } | null;
  priceFixes: PriceFix[];
  missing: MissingGroup[];
  pastAttempts: { id: number; title: string }[];
  /** Variants on Shopify not linked to any BB option yet (e.g. added on Shopify directly). */
  unlinked: { id: number; title: string }[];
  batchMismatch: BatchMismatch[];
  dropped: Dropped[];
};

export type Rule = { id: string; kind: string; key: string; answer: string; label: string; settles: number; decidedAt: string };
/** Groups of To do items with one root cause: one answer settles them all. */
export type Causes = {
  optionTypes: { key: string; label: string; count: number; listings: { pid: number; title: string; labels: string[] }[] }[];
  past: { count: number; listings: { pid: number; title: string; variants: { id: number; title: string }[] }[] };
  confirm: { reason: string; listings: { pid: number; title: string; count: number }[] }[];
  priceDown: { count: number; listings: { pid: number; title: string; fixes: PriceFix[] }[] };
};

export type Todo = {
  error: string | null;
  listings: TodoListing[];
  vendorReadAt: string | null;
  shopifyReadAt: string | null;
  counts: { attempt: number; confirm: number; price: number; missing: number; past: number; dropped: number; batch: number };
  causes: Causes;
  rules: Rule[];
};

function rows<T>(supabase: Supa, table: string, cols: string, filter?: (q: any) => any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return fetchAllRows<T>((from, to) => {
    let q = supabase.from(table as "vendor_options").select(cols).range(from, to); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (filter) q = filter(q);
    return q as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  });
}

export async function computeTodo(supabase: Supa): Promise<Todo> {
  const empty = { listings: [], vendorReadAt: null, shopifyReadAt: null, counts: { attempt: 0, confirm: 0, price: 0, missing: 0, past: 0, dropped: 0, batch: 0 }, causes: { optionTypes: [], past: { count: 0, listings: [] }, confirm: [], priceDown: { count: 0, listings: [] } }, rules: [] };
  const [L, O, S, A, D] = await Promise.all([
    rows<Link>(
      supabase,
      "vendor_variant_links",
      "id, shopify_product_id, shopify_variant_id, shopify_product_title, shopify_product_handle, shopify_variant_title, vendor_site_id, vendor_product_slug, vendor_product_title, vendor_variant_id, vendor_variant_label, status, reason, shopify_price, shopify_compare_at, keep_price",
      (q) => q.in("status", ["approved", "suggested", "no_match"]),
    ),
    rows<Opt>(supabase, "vendor_options", "vendor_site_id, product_slug, product_title, variant_id, label, price, state, last_seen_at"),
    rows<Sib>(supabase, "listing_vendor_products", "shopify_product_id, vendor_site_id, product_slug, product_title, attempts"),
    rows<Alt>(supabase, "link_alternatives", "shopify_product_id, shopify_variant_id, vendor_site_id, product_slug, product_title, attempts, vendor_price, vendor_variant_label"),
    rows<Dec>(supabase, "listing_gap_decisions", "shopify_product_id, vendor_site_id, product_slug, variant_id"),
  ]);
  const err = L.error ?? O.error ?? S.error ?? A.error ?? D.error;
  if (err) return { error: err, ...empty };

  const { data: sites } = await supabase.from("vendor_sites").select("id, name, website_url");
  const { data: ruleRows, error: ruleErr } = await supabase.from("price_check_rules").select("id, kind, key, answer, decided_at");
  if (ruleErr) return { error: ruleErr.message, ...empty };
  const neverSell = new Set((ruleRows ?? []).filter((r) => r.kind === "option_type" && r.answer === "never_sell").map((r) => r.key));
  const keepWhenLower = (ruleRows ?? []).some((r) => r.kind === "price_down" && r.answer === "keep_ours");
  const ruleHits = new Map<string, number>();
  const hit = (k: string) => ruleHits.set(k, (ruleHits.get(k) ?? 0) + 1);
  const site = new Map((sites ?? []).map((s) => [s.id, s]));

  const opt = new Map<string, Opt>();
  const optsByProduct = new Map<string, Opt[]>();
  let vendorReadAt: string | null = null;
  for (const o of O.rows) {
    const pk = `${o.vendor_site_id}|${o.product_slug}`;
    opt.set(`${pk}|${o.variant_id}`, o);
    (optsByProduct.get(pk) ?? optsByProduct.set(pk, []).get(pk)!).push(o);
    if (!vendorReadAt || o.last_seen_at > vendorReadAt) vendorReadAt = o.last_seen_at;
  }
  // A vendor option already sold on any Zeroinfy listing (e.g. the separate English listing) isn't missing.
  const linkedAnywhere = new Set(
    L.rows.filter((l) => l.status !== "no_match" && l.vendor_variant_id).map((l) => `${l.vendor_site_id}|${l.vendor_product_slug}|${l.vendor_variant_id}`),
  );
  const ignored = new Set(D.rows.map((d) => `${d.shopify_product_id}|${d.vendor_site_id}|${d.product_slug}|${d.variant_id}`));
  const group = <T extends { shopify_product_id: number }>(xs: T[]) => {
    const m = new Map<number, T[]>();
    for (const x of xs) (m.get(x.shopify_product_id) ?? m.set(x.shopify_product_id, []).get(x.shopify_product_id)!).push(x);
    return m;
  };
  const linksBy = group(L.rows);
  const sibsBy = group(S.rows);
  const altsBy = group(A.rows);
  const linkByVariant = new Map(L.rows.map((l) => [Number(l.shopify_variant_id), l]));

  const { data: seen } = await supabase.from("vendor_variant_links").select("shopify_seen_at").not("shopify_seen_at", "is", null).order("shopify_seen_at", { ascending: false }).limit(1);
  const shopifyReadAt = seen?.[0]?.shopify_seen_at ?? null;

  const out: TodoListing[] = [];
  const counts = { attempt: 0, confirm: 0, price: 0, missing: 0, past: 0, dropped: 0, batch: 0 };

  for (const [pid, ls] of linksBy) {
    const live = ls.filter((l) => l.status !== "no_match");
    const first = ls[0];
    const item: TodoListing = { pid, title: first.shopify_product_title, handle: first.shopify_product_handle, attemptQuestion: null, confirm: null, priceFixes: [], missing: [], pastAttempts: [], unlinked: [], batchMismatch: [], dropped: [] };

    // 1. Attempt question (unclear attempt, several vendor products fit).
    const alts = altsBy.get(pid);
    if (alts?.length) {
      // Group variants by the set of vendor products that fit them.
      const perVariant = new Map<number, Alt[]>();
      for (const a of alts) (perVariant.get(Number(a.shopify_variant_id)) ?? perVariant.set(Number(a.shopify_variant_id), []).get(Number(a.shopify_variant_id))!).push(a);
      const groups = new Map<string, AttemptGroup>();
      for (const [vid, as] of perVariant) {
        const key = as.map((a) => `${a.vendor_site_id}|${a.product_slug}`).sort().join(",");
        let g = groups.get(key);
        if (!g) {
          g = {
            variantIds: [],
            variants: [],
            choices: as.map((a) => ({
              siteId: a.vendor_site_id,
              siteUrl: site.get(a.vendor_site_id)?.website_url ?? "",
              slug: a.product_slug,
              productTitle: a.product_title,
              attempts: a.attempts,
              price: a.vendor_price == null ? null : Number(a.vendor_price),
              label: a.vendor_variant_label,
            })),
          };
          groups.set(key, g);
        }
        const l = linkByVariant.get(vid);
        g.variantIds.push(vid);
        g.variants.push({ title: l?.shopify_variant_title ?? String(vid), price: l?.shopify_price == null ? null : Number(l.shopify_price) });
      }
      item.attemptQuestion = [...groups.values()];
    }

    // 2. Price fixes (linked option still for sale, Zeroinfy price off the rule).
    if (!item.attemptQuestion) {
      for (const l of live) {
        if (l.shopify_price == null || !l.vendor_variant_id || l.keep_price) continue;
        const o = opt.get(`${l.vendor_site_id}|${l.vendor_product_slug}|${l.vendor_variant_id}`);
        if (!o || o.state !== "live" || o.price == null || Number(o.price) <= 0) continue;
        const e = expectedZeroinfyPrice(Number(o.price), l.shopify_product_title);
        if (!priceOk(Number(l.shopify_price), e.price)) {
          if (keepWhenLower && e.price < Number(l.shopify_price)) {
            hit("price_down|all");
            continue;
          }
          item.priceFixes.push({
            linkId: l.id,
            variantId: l.shopify_variant_id,
            variantTitle: l.shopify_variant_title ?? "Default",
            current: Number(l.shopify_price),
            compareAt: l.shopify_compare_at == null ? null : Number(l.shopify_compare_at),
            vendorPrice: Number(o.price),
            expected: e.price,
            rule: e.rule,
            vendorLabel: o.label,
            vendorUrl: `${site.get(l.vendor_site_id)?.website_url ?? ""}/product/${l.vendor_product_slug}`,
            vendorTitle: l.vendor_product_title,
            confirmed: l.status === "approved",
          });
        }
      }
    }

    // 3. Confirm: unreviewed links with no price issue and no attempt question.
    const pending = live.filter((l) => l.status === "suggested");
    if (!item.attemptQuestion && pending.length && !item.priceFixes.length) {
      const prods = new Map<string, { title: string; url: string }>();
      for (const l of pending) {
        if (!l.vendor_product_slug) continue;
        prods.set(l.vendor_product_slug, { title: l.vendor_product_title ?? l.vendor_product_slug, url: `${site.get(l.vendor_site_id)?.website_url ?? ""}/product/${l.vendor_product_slug}` });
      }
      item.confirm = {
        reasons: [...new Set(pending.map((l) => (l.reason ?? "").split("'.").slice(-1)[0].trim()).filter(Boolean))].slice(0, 3),
        count: pending.length,
        products: [...prods.values()],
      };
    }

    // 4. Missing: options of linked products no variant sells; sibling products (other attempts) not linked at all.
    if (!item.attemptQuestion) {
      const linkedVar = new Set(live.filter((l) => l.vendor_variant_id).map((l) => `${l.vendor_site_id}|${l.vendor_product_slug}|${l.vendor_variant_id}`));
      const linkedProd = new Set(live.filter((l) => l.vendor_product_slug).map((l) => `${l.vendor_site_id}|${l.vendor_product_slug}`));
      const sibs = (sibsBy.get(pid) ?? []).filter((s) => s.attempts !== "added by hand" && !linkedProd.has(`${s.vendor_site_id}|${s.product_slug}`));
      const prods: { pk: string; kind: "batch" | "attempt"; attempts: string | null; title: string | null }[] = [
        ...[...linkedProd].map((pk) => ({ pk, kind: "batch" as const, attempts: null, title: live.find((l) => `${l.vendor_site_id}|${l.vendor_product_slug}` === pk)?.vendor_product_title ?? null })),
        ...sibs.map((s) => ({ pk: `${s.vendor_site_id}|${s.product_slug}`, kind: "attempt" as const, attempts: s.attempts, title: s.product_title })),
      ];
      for (const p of prods) {
        const [siteId, slug] = p.pk.split("|");
        const s = site.get(siteId);
        const options = (optsByProduct.get(p.pk) ?? [])
          .filter((o) => o.state === "live" && Number(o.price ?? 0) > 0)
          .filter((o) => !linkedVar.has(`${p.pk}|${o.variant_id}`) && !linkedAnywhere.has(`${p.pk}|${o.variant_id}`) && !ignored.has(`${pid}|${p.pk}|${o.variant_id}`))
          .filter((o) => {
            const t = optionType(o.label);
            if (t && neverSell.has(t.key)) {
              hit(`option_type|${t.key}`);
              return false;
            }
            return true;
          })
          .map((o) => ({
            siteId,
            slug,
            productTitle: o.product_title ?? p.title,
            variantId: o.variant_id,
            label: o.label,
            price: o.price == null ? null : Number(o.price),
            expected: o.price == null ? null : expectedZeroinfyPrice(Number(o.price), first.shopify_product_title).price,
          }));
        const auto =
          p.kind === "attempt"
            ? planAttempt(
                ls.map((l) => ({ ...l, shopify_variant_id: Number(l.shopify_variant_id) })),
                p.attempts,
                (optsByProduct.get(p.pk) ?? []).map((o) => ({ variant_id: o.variant_id, label: o.label, price: o.price == null ? null : Number(o.price), state: o.state })),
              )
            : null;
        if (options.length) item.missing.push({ siteId, siteName: s?.name ?? "", siteUrl: s?.website_url ?? "", slug, productTitle: p.title, attempts: p.attempts, kind: p.kind, options, auto });
      }

      // 6. Vendor dropped a linked option.
      const gone = new Map<string, Dropped>();
      for (const l of live) {
        if (l.status !== "approved" || !l.vendor_variant_id) continue;
        const o = opt.get(`${l.vendor_site_id}|${l.vendor_product_slug}|${l.vendor_variant_id}`);
        if (o?.state === "gone") {
          let g = gone.get(o.variant_id);
          if (!g) {
            // Same product, same option names, exactly one value different (e.g. the batch) → BB replaced it.
            const op = parts(o.label);
            let replacement: Dropped["replacement"] = null;
            for (const c of optsByProduct.get(`${l.vendor_site_id}|${l.vendor_product_slug}`) ?? []) {
              if (c.state !== "live" || Number(c.price ?? 0) <= 0) continue;
              const cp = parts(c.label);
              if (cp.length !== op.length || cp.map(partKey).join("|") !== op.map(partKey).join("|")) continue;
              const diff = cp.filter((p, i) => p.toLowerCase() !== op[i].toLowerCase());
              if (diff.length === 1) {
                if (replacement) { replacement = null; break; } // two candidates: leave it to a person
                replacement = { id: c.variant_id, label: c.label, price: c.price == null ? null : Number(c.price), changed: diff[0] };
              }
            }
            g = { label: o.label, variants: 0, linkIds: [], slug: l.vendor_product_slug!, productTitle: l.vendor_product_title, replacement };
            gone.set(o.variant_id, g);
          }
          g.variants++;
          g.linkIds.push(l.id);
        }
      }
      item.dropped = [...gone.values()];
    }

    // 5. Past attempts still on the listing.
    item.pastAttempts = ls
      .filter((l) => l.status === "no_match" && /has passed/.test(l.reason ?? "") && attemptHasPassed(l.shopify_variant_title))
      .map((l) => ({ id: Number(l.shopify_variant_id), title: l.shopify_variant_title ?? "Default" }));

    // 7. Batch names: the linked BB option's batch dates differ from the Zeroinfy variant's,
    //    while another option of the same BB product carries exactly those dates.
    if (!item.attemptQuestion) {
      for (const l of live) {
        if (!l.vendor_variant_id || !l.vendor_product_slug) continue;
        if (ignored.has(`${pid}|${l.vendor_site_id}|${l.vendor_product_slug}|batch-ok:${l.shopify_variant_id}`)) continue;
        const opts = (optsByProduct.get(`${l.vendor_site_id}|${l.vendor_product_slug}`) ?? []).filter(
          (o) => o.state === "live" && Number(o.price ?? 0) > 0 && o.variant_id !== l.vendor_variant_id,
        );
        const zd = ziBatchDates(l.shopify_variant_title);
        const zb = ziBooks(l.shopify_variant_title);
        const cb = vendorBooks(l.vendor_variant_label);
        const datesOff = !l.keep_price && zd.size > 0 && !covers(vendorBatchDates(l.vendor_variant_label), zd);
        const booksOff = !!zb && !!cb && zb !== cb;
        if (!datesOff && !booksOff) continue;
        let better: Opt | undefined;
        let why: "batch" | "books" = "batch";
        if (datesOff) better = opts.find((o) => covers(vendorBatchDates(o.label), zd) && (!zb || vendorBooks(o.label) !== (zb === "with" ? "without" : "with")));
        if (!better && booksOff) {
          why = "books";
          const base = withoutBooksPart(l.vendor_variant_label ?? "");
          better = opts.find((o) => vendorBooks(o.label) === zb && withoutBooksPart(o.label) === base);
        }
        if (!better) continue;
        item.batchMismatch.push({
          why,
          linkId: l.id,
          variantId: Number(l.shopify_variant_id),
          variantTitle: l.shopify_variant_title ?? "Default",
          ziDates: why === "books" ? (zb === "with" ? "with Hard Copy" : "without Hard Copy") : fmtDates(zd),
          currentLabel: l.vendor_variant_label ?? "",
          siteId: l.vendor_site_id,
          slug: l.vendor_product_slug,
          productTitle: l.vendor_product_title,
          suggestId: better.variant_id,
          suggestLabel: better.label,
          suggestPrice: better.price == null ? null : Number(better.price),
        });
      }
      // A wrong option means its price fix is wrong too: hold those until the batch is settled.
      const held = new Set(item.batchMismatch.map((b) => b.linkId));
      item.priceFixes = item.priceFixes.filter((f) => !held.has(f.linkId));
    }

    item.unlinked = ls
      .filter((l) => l.status === "no_match" && (/^(New on Shopify|BB product chosen by hand)/.test(l.reason ?? "") || (/has passed/.test(l.reason ?? "") && !attemptHasPassed(l.shopify_variant_title))) && !altsBy.get(pid)?.some((a) => Number(a.shopify_variant_id) === Number(l.shopify_variant_id)))
      .map((l) => ({ id: Number(l.shopify_variant_id), title: l.shopify_variant_title ?? "Default" }));

    if (item.attemptQuestion || item.unlinked.length) counts.attempt++;
    if (item.confirm) counts.confirm++;
    counts.price += item.priceFixes.length;
    counts.missing += item.missing.reduce((n, g) => n + g.options.length, 0);
    counts.past += item.pastAttempts.length;
    counts.dropped += item.dropped.length;
    counts.batch += item.batchMismatch.length;
    if (item.attemptQuestion || item.unlinked.length || item.batchMismatch.length || item.confirm || item.priceFixes.length || item.missing.length || item.pastAttempts.length || item.dropped.length) out.push(item);
  }
  out.sort((a, b) => a.title.localeCompare(b.title));

  // Common causes: one answer settles many items.
  const causes: Causes = { optionTypes: [], past: { count: 0, listings: [] }, confirm: [], priceDown: { count: 0, listings: [] } };
  const answered = new Set((ruleRows ?? []).filter((r) => r.kind === "option_type").map((r) => r.key));
  const byType = new Map<string, Causes["optionTypes"][number]>();
  for (const l of out) {
    for (const g of l.missing) {
      for (const o of g.options) {
        const t = optionType(o.label);
        if (!t || answered.has(t.key)) continue;
        const c = byType.get(t.key) ?? byType.set(t.key, { key: t.key, label: t.label, count: 0, listings: [] }).get(t.key)!;
        c.count++;
        let li = c.listings.find((x) => x.pid === l.pid);
        if (!li) c.listings.push((li = { pid: l.pid, title: l.title, labels: [] }));
        li.labels.push(o.label);
      }
    }
    if (l.pastAttempts.length) {
      causes.past.count += l.pastAttempts.length;
      causes.past.listings.push({ pid: l.pid, title: l.title, variants: l.pastAttempts });
    }
    const down = l.priceFixes.filter((f) => f.expected < f.current);
    if (down.length) {
      causes.priceDown.count += down.length;
      causes.priceDown.listings.push({ pid: l.pid, title: l.title, fixes: down });
    }
  }
  causes.optionTypes = OPTION_TYPES.map((t) => byType.get(t.key)).filter((x): x is NonNullable<typeof x> => !!x && x.count > 0);
  if (keepWhenLower) causes.priceDown = { count: 0, listings: [] };
  const byReason = new Map<string, Causes["confirm"][number]>();
  for (const l of out) {
    if (!l.confirm) continue;
    for (const r of l.confirm.reasons) {
      const c = byReason.get(r) ?? byReason.set(r, { reason: r, listings: [] }).get(r)!;
      c.listings.push({ pid: l.pid, title: l.title, count: l.confirm.count });
    }
  }
  causes.confirm = [...byReason.values()].filter((c) => c.listings.length >= 2).sort((a, b) => b.listings.length - a.listings.length);

  const labelOf = (kind: string, key: string) =>
    kind === "option_type" ? (OPTION_TYPES.find((t) => t.key === key)?.label ?? key) : "When BB's price is lower than ours";
  const rules: Rule[] = (ruleRows ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    key: r.key,
    answer: r.answer,
    label: labelOf(r.kind, r.key),
    settles: ruleHits.get(`${r.kind}|${r.key}`) ?? 0,
    decidedAt: r.decided_at,
  }));
  return { error: null, listings: out, vendorReadAt, shopifyReadAt, counts, causes, rules };
}
