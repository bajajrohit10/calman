import "server-only";

import type { EdportalVariant } from "@/lib/price-check/edportal";
import type { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;

/** Store one vendor product's current options; anything no longer listed becomes 'gone'. */
export async function storeVendorOptions(
  supabase: Supa,
  siteId: string,
  slug: string,
  title: string | null,
  variants: EdportalVariant[],
): Promise<string | null> {
  const now = new Date().toISOString();
  if (variants.length) {
    const { error } = await supabase.from("vendor_options").upsert(
      variants.map((v) => ({
        vendor_site_id: siteId,
        product_slug: slug,
        product_title: title,
        variant_id: v.id,
        label: v.title.slice(0, 1000) || "Default",
        price: v.price,
        mrp: v.mrp,
        state: "live",
        last_seen_at: now,
      })),
      { onConflict: "vendor_site_id,product_slug,variant_id" },
    );
    if (error) return error.message;
  }
  const keep = variants.map((v) => v.id);
  let q = supabase.from("vendor_options").update({ state: "gone" }).eq("vendor_site_id", siteId).eq("product_slug", slug).eq("state", "live");
  if (keep.length) q = q.not("variant_id", "in", `(${keep.map((k) => `"${k.replace(/"/g, "")}"`).join(",")})`);
  const { error } = await q;
  return error?.message ?? null;
}

