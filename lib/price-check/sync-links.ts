import "server-only";

import type { ShopifyProductForEdit } from "@/lib/price-check/shopify-edit";
import type { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Bring a listing's links in step with Shopify as it is now:
 *  - prices / titles snapshotted on every link;
 *  - links of variants deleted on Shopify removed;
 *  - variants added on Shopify directly get an unlinked row ("pick the BB
 *    option"), so they can be linked in Batches & options.
 */
export async function syncLinksWithShopify(supabase: Supa, p: ShopifyProductForEdit): Promise<{ added: number }> {
  const now = new Date().toISOString();
  const { data: links } = await supabase.from("vendor_variant_links").select("id, shopify_variant_id, vendor_site_id").eq("shopify_product_id", p.id);
  const byId = new Map(p.variants.map((v) => [v.id, v]));
  await Promise.all(
    (links ?? []).map((l) => {
      const v = byId.get(Number(l.shopify_variant_id));
      if (!v) return supabase.from("vendor_variant_links").delete().eq("id", l.id);
      return supabase
        .from("vendor_variant_links")
        .update({ shopify_price: v.price, shopify_compare_at: v.compareAtPrice, shopify_variant_title: v.title, shopify_product_title: p.title, shopify_product_handle: p.handle, shopify_seen_at: now })
        .eq("id", l.id);
    }),
  );
  const have = new Set((links ?? []).map((l) => Number(l.shopify_variant_id)));
  const fresh = p.variants.filter((v) => !have.has(v.id));
  // The vendor this listing resells (the one most of its links point at).
  const tally = new Map<string, number>();
  for (const l of links ?? []) tally.set(l.vendor_site_id, (tally.get(l.vendor_site_id) ?? 0) + 1);
  const siteId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!fresh.length || !siteId) return { added: 0 };
  const { error } = await supabase.from("vendor_variant_links").upsert(
    fresh.map((v) => ({
      shopify_product_id: p.id,
      shopify_variant_id: v.id,
      shopify_product_title: p.title,
      shopify_product_handle: p.handle,
      shopify_variant_title: v.title,
      vendor_site_id: siteId,
      status: "no_match",
      confidence: "low",
      reason: "New on Shopify — pick the BB option it resells.",
      suggested_by: "shopify-sync",
      shopify_price: v.price,
      shopify_compare_at: v.compareAtPrice,
      shopify_seen_at: now,
    })),
    { onConflict: "shopify_variant_id", ignoreDuplicates: true },
  );
  return { added: error ? 0 : fresh.length };
}
