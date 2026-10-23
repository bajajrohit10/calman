import "server-only";

import { fetchAllRows } from "@/lib/paged";
import type { createClient } from "@/lib/supabase/server";

/**
 * Price check: what's missing on Zeroinfy, per listing.
 *
 * For every listing with at least one approved link, take the vendor products
 * it is linked to and compare their stored options (vendor_options) with the
 * options its variants point to:
 *   - missing: the vendor sells an option no variant of the listing points to
 *     (and nobody marked "we don't sell this") → a batch/mode to create;
 *   - gone: an approved link points to an option the vendor no longer lists.
 */

type Supa = Awaited<ReturnType<typeof createClient>>;

export type GapOption = {
  siteId: string;
  siteName: string;
  siteUrl: string;
  slug: string;
  productTitle: string | null;
  variantId: string;
  label: string;
  price: number | null;
};

export type ListingGaps = {
  pid: number;
  title: string;
  handle: string | null;
  missing: GapOption[];
  gone: (GapOption & { variants: number })[];
};

type LinkLite = {
  shopify_product_id: number;
  shopify_product_title: string;
  shopify_product_handle: string | null;
  vendor_site_id: string;
  vendor_product_slug: string | null;
  vendor_variant_id: string | null;
  status: string;
};

export async function computeGaps(supabase: Supa): Promise<{ error: string | null; listings: ListingGaps[]; refreshedAt: string | null }> {
  const links = await fetchAllRows<LinkLite>((from, to) =>
    supabase
      .from("vendor_variant_links")
      .select("shopify_product_id, shopify_product_title, shopify_product_handle, vendor_site_id, vendor_product_slug, vendor_variant_id, status")
      .in("status", ["approved", "suggested"])
      .range(from, to) as unknown as PromiseLike<{ data: LinkLite[] | null; error: { message: string } | null }>,
  );
  if (links.error) return { error: links.error, listings: [], refreshedAt: null };

  type Opt = { vendor_site_id: string; product_slug: string; product_title: string | null; variant_id: string; label: string; price: number | null; state: string; last_seen_at: string };
  const opts = await fetchAllRows<Opt>((from, to) =>
    supabase
      .from("vendor_options")
      .select("vendor_site_id, product_slug, product_title, variant_id, label, price, state, last_seen_at")
      .range(from, to) as unknown as PromiseLike<{ data: Opt[] | null; error: { message: string } | null }>,
  );
  if (opts.error) return { error: opts.error, listings: [], refreshedAt: null };

  type Dec = { shopify_product_id: number; vendor_site_id: string; product_slug: string; variant_id: string };
  const decs = await fetchAllRows<Dec>((from, to) =>
    supabase
      .from("listing_gap_decisions")
      .select("shopify_product_id, vendor_site_id, product_slug, variant_id")
      .range(from, to) as unknown as PromiseLike<{ data: Dec[] | null; error: { message: string } | null }>,
  );
  if (decs.error) return { error: decs.error, listings: [], refreshedAt: null };

  const { data: sites } = await supabase.from("vendor_sites").select("id, name, website_url");
  const site = new Map((sites ?? []).map((s) => [s.id, s]));

  const optsByProduct = new Map<string, Opt[]>();
  let refreshedAt: string | null = null;
  for (const o of opts.rows) {
    const k = `${o.vendor_site_id}|${o.product_slug}`;
    (optsByProduct.get(k) ?? optsByProduct.set(k, []).get(k)!).push(o);
    if (!refreshedAt || o.last_seen_at > refreshedAt) refreshedAt = o.last_seen_at;
  }
  const ignored = new Set(decs.rows.map((d) => `${d.shopify_product_id}|${d.vendor_site_id}|${d.product_slug}|${d.variant_id}`));

  const byPid = new Map<number, LinkLite[]>();
  for (const l of links.rows) (byPid.get(l.shopify_product_id) ?? byPid.set(l.shopify_product_id, []).get(l.shopify_product_id)!).push(l);

  const out: ListingGaps[] = [];
  for (const [pid, ls] of byPid) {
    if (!ls.some((l) => l.status === "approved")) continue; // only listings someone has reviewed
    const linked = new Set(ls.filter((l) => l.vendor_variant_id).map((l) => `${l.vendor_site_id}|${l.vendor_product_slug}|${l.vendor_variant_id}`));
    const products = [...new Set(ls.filter((l) => l.vendor_product_slug).map((l) => `${l.vendor_site_id}|${l.vendor_product_slug}`))];
    const missing: GapOption[] = [];
    const gone = new Map<string, GapOption & { variants: number }>();
    for (const pk of products) {
      const [siteId, slug] = pk.split("|");
      const s = site.get(siteId);
      const list = optsByProduct.get(pk) ?? [];
      const mk = (o: Opt): GapOption => ({
        siteId,
        siteName: s?.name ?? "",
        siteUrl: s?.website_url ?? "",
        slug,
        productTitle: o.product_title,
        variantId: o.variant_id,
        label: o.label,
        price: o.price == null ? null : Number(o.price),
      });
      for (const o of list) {
        const key = `${siteId}|${slug}|${o.variant_id}`;
        // Zero-price options are BB's internal placeholders (e.g. "CAF DT REG-Hindi MN27 010626"), not for sale.
        if (o.state === "live" && Number(o.price ?? 0) > 0 && !linked.has(key) && !ignored.has(`${pid}|${key}`)) missing.push(mk(o));
      }
      for (const l of ls) {
        if (l.status !== "approved" || `${l.vendor_site_id}|${l.vendor_product_slug}` !== pk) continue;
        const o = list.find((x) => x.variant_id === l.vendor_variant_id);
        if (o && o.state === "gone") {
          const g = gone.get(o.variant_id) ?? { ...mk(o), variants: 0 };
          g.variants++;
          gone.set(o.variant_id, g);
        }
      }
    }
    if (missing.length || gone.size) {
      out.push({ pid, title: ls[0].shopify_product_title, handle: ls[0].shopify_product_handle, missing, gone: [...gone.values()] });
    }
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return { error: null, listings: out, refreshedAt };
}
