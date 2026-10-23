"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { readEdportalProduct } from "@/lib/price-check/edportal";
import { storeVendorOptions } from "@/lib/price-check/vendor-options";
import { createClient } from "@/lib/supabase/server";

/**
 * Price check: keeping the vendor-options snapshot fresh, and "we don't sell
 * this" decisions, for Settings → Links → Missing on Zeroinfy.
 */

const PATH = "/settings/links";
const DENIED = "Only a manager or super admin can do this.";

async function gate() {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) return null;
  return viewer;
}

/** The vendor products linked from Zeroinfy listings that can be read (course-platform sites). */
export async function vendorProductsToRefresh(): Promise<{ error: string | null; items?: { siteId: string; slug: string; title: string | null }[] }> {
  if (!(await gate())) return { error: DENIED };
  const supabase = await createClient();
  const { data: sites } = await supabase.from("vendor_sites").select("id, read_method");
  const readable = new Set((sites ?? []).filter((s) => s.read_method === "edportal_feed").map((s) => s.id));
  const seen = new Map<string, { siteId: string; slug: string; title: string | null }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("vendor_variant_links")
      .select("vendor_site_id, vendor_product_slug, vendor_product_title")
      .in("status", ["approved", "suggested"])
      .not("vendor_product_slug", "is", null)
      .range(from, from + 999);
    if (error) return { error: error.message };
    for (const r of data ?? []) {
      if (!readable.has(r.vendor_site_id)) continue;
      const k = `${r.vendor_site_id}|${r.vendor_product_slug}`;
      if (!seen.has(k)) seen.set(k, { siteId: r.vendor_site_id, slug: r.vendor_product_slug!, title: r.vendor_product_title });
    }
    if (!data || data.length < 1000) break;
  }
  // Sibling vendor products (the same course for other attempts) too.
  const { data: sibs } = await supabase.from("listing_vendor_products").select("vendor_site_id, product_slug, product_title").limit(5000);
  for (const r of sibs ?? []) {
    if (!readable.has(r.vendor_site_id)) continue;
    const k = `${r.vendor_site_id}|${r.product_slug}`;
    if (!seen.has(k)) seen.set(k, { siteId: r.vendor_site_id, slug: r.product_slug, title: r.product_title });
  }
  return { error: null, items: [...seen.values()] };
}

/** Re-read up to 10 vendor products and store their options. */
export async function refreshVendorOptions(
  items: { siteId: string; slug: string; title: string | null }[],
): Promise<{ error: string | null; count?: number; failed?: string[] }> {
  if (!(await gate())) return { error: DENIED };
  if (items.length > 10) return { error: "At most 10 per call." };
  const supabase = await createClient();
  const { data: sites } = await supabase.from("vendor_sites").select("id, website_url, read_method");
  const url = new Map((sites ?? []).filter((s) => s.read_method === "edportal_feed").map((s) => [s.id, s.website_url]));
  const failed: string[] = [];
  let count = 0;
  for (const it of items) {
    const base = url.get(it.siteId);
    if (!base) continue;
    const r = await readEdportalProduct(new URL(base).origin, it.slug);
    if (!r.ok) {
      // A product page that has disappeared: every option of it is gone.
      if (/HTTP 404|No variant data/.test(r.reason)) await storeVendorOptions(supabase, it.siteId, it.slug, it.title, []);
      failed.push(`${it.title ?? it.slug}: ${r.reason}`);
      continue;
    }
    const err = await storeVendorOptions(supabase, it.siteId, it.slug, it.title, r.variants);
    if (err) failed.push(`${it.title ?? it.slug}: ${err}`);
    else count++;
    await new Promise((res) => setTimeout(res, 200));
  }
  return { error: null, count, failed };
}

export async function finishRefresh(): Promise<void> {
  revalidatePath(PATH);
}

export async function ignoreGap(pid: number, siteId: string, slug: string, variantId: string, note: string): Promise<{ error: string | null }> {
  const viewer = await gate();
  if (!viewer) return { error: DENIED };
  const supabase = await createClient();
  const { error } = await supabase.from("listing_gap_decisions").upsert(
    { shopify_product_id: pid, vendor_site_id: siteId, product_slug: slug, variant_id: variantId, decision: "ignore", note: note.trim() || null, decided_by: viewer.userId },
    { onConflict: "shopify_product_id,vendor_site_id,product_slug,variant_id" },
  );
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { error: null };
}
