"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { getProductForEdit, updatePrices } from "@/lib/price-check/shopify-edit";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * Price check: actions behind Settings → Links → "To do on Zeroinfy".
 */

const PATH = "/settings/links";
const DENIED = "Only a manager or super admin can do this.";

async function gate() {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) return null;
  return viewer;
}

/** Every Zeroinfy listing that has links (to re-read prices from Shopify). */
export async function shopifyProductsToRefresh(): Promise<{ error: string | null; pids?: number[] }> {
  if (!(await gate())) return { error: DENIED };
  const supabase = await createClient();
  const pids = new Set<number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("vendor_variant_links").select("shopify_product_id").range(from, from + 999);
    if (error) return { error: error.message };
    for (const r of data ?? []) pids.add(Number(r.shopify_product_id));
    if (!data || data.length < 1000) break;
  }
  return { error: null, pids: [...pids] };
}

/** Re-read up to 10 listings from Shopify: prices, titles; drop links of variants deleted on Shopify. */
export async function refreshShopify(pids: number[]): Promise<{ error: string | null; failed?: string[] }> {
  if (!(await gate())) return { error: DENIED };
  if (pids.length > 10) return { error: "At most 10 per call." };
  const supabase = await createClient();
  const failed: string[] = [];
  const now = new Date().toISOString();
  // Listings in parallel, and each listing's link updates in parallel: one round trip per step.
  await Promise.all(
    pids.map(async (pid) => {
      let p;
      try {
        p = await getProductForEdit(pid);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/no longer on Shopify/.test(msg)) await supabase.from("vendor_variant_links").delete().eq("shopify_product_id", pid);
        failed.push(`${pid}: ${msg}`);
        return;
      }
      const { data: links } = await supabase.from("vendor_variant_links").select("id, shopify_variant_id").eq("shopify_product_id", pid);
      const byId = new Map(p.variants.map((v) => [v.id, v]));
      await Promise.all(
        (links ?? []).map((l) => {
          const v = byId.get(Number(l.shopify_variant_id));
          if (!v) return supabase.from("vendor_variant_links").delete().eq("id", l.id);
          return supabase
            .from("vendor_variant_links")
            .update({ shopify_price: v.price, shopify_compare_at: v.compareAtPrice, shopify_variant_title: v.title, shopify_product_title: p.title, shopify_seen_at: now })
            .eq("id", l.id);
        }),
      );
    }),
  );
  return { error: null, failed };
}

/** "It's May 27": re-link every variant of the listing to that vendor product, approved. */
export async function answerAttempt(pid: number, siteId: string, slug: string): Promise<{ error: string | null; count?: number }> {
  const viewer = await gate();
  if (!viewer) return { error: DENIED };
  const supabase = await createClient();
  const { data: alts, error } = await supabase
    .from("link_alternatives")
    .select("shopify_variant_id, product_title, vendor_variant_id, vendor_variant_label")
    .eq("shopify_product_id", pid)
    .eq("vendor_site_id", siteId)
    .eq("product_slug", slug);
  if (error) return { error: error.message };
  if (!alts?.length) return { error: "No options stored for that choice — reload." };
  const now = new Date().toISOString();
  let count = 0;
  for (const a of alts) {
    const { data } = await supabase
      .from("vendor_variant_links")
      .update({
        vendor_site_id: siteId,
        vendor_product_slug: slug,
        vendor_product_title: a.product_title,
        vendor_variant_id: a.vendor_variant_id,
        vendor_variant_label: a.vendor_variant_label,
        status: "approved",
        confidence: "high",
        review_note: "Attempt chosen in To do on Zeroinfy.",
        reviewed_by: viewer.userId,
        reviewed_at: now,
      })
      .eq("shopify_variant_id", a.shopify_variant_id)
      .neq("status", "no_match")
      .select("id");
    count += data?.length ?? 0;
  }
  await supabase.from("link_alternatives").delete().eq("shopify_product_id", pid);
  revalidatePath(PATH);
  return { error: null, count };
}

/** Approve every still-suggested link of a listing ("Looks right"). */
export async function confirmListing(pid: number): Promise<{ error: string | null; count?: number }> {
  const viewer = await gate();
  if (!viewer) return { error: DENIED };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_variant_links")
    .update({ status: "approved", reviewed_by: viewer.userId, reviewed_at: new Date().toISOString(), review_note: "Confirmed in To do on Zeroinfy." })
    .eq("shopify_product_id", pid)
    .eq("status", "suggested")
    .select("id");
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { error: null, count: data?.length ?? 0 };
}

export type PriceFixIn = { pid: number; title: string; linkId: string; variantId: number; price: number; compareAt: number | null };

/** Set Zeroinfy prices on Shopify (super admin), grouped per listing; approves those links; logged. */
export async function fixPrices(items: PriceFixIn[]): Promise<{ error: string | null; count?: number; failed?: string[] }> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") return { error: "Only a super admin can change Shopify prices." };
  if (!items.length) return { error: null, count: 0 };
  if (items.length > 500) return { error: "Too many at once (max 500)." };
  for (const i of items) if (!(i.price > 0) || (i.compareAt != null && i.compareAt < i.price)) return { error: `Bad price for variant ${i.variantId}.` };
  const supabase = await createClient();
  const byPid = new Map<number, PriceFixIn[]>();
  for (const i of items) (byPid.get(i.pid) ?? byPid.set(i.pid, []).get(i.pid)!).push(i);
  let count = 0;
  const failed: string[] = [];
  const now = new Date().toISOString();
  for (const [pid, xs] of byPid) {
    const req = xs.map((x) => ({ variantId: x.variantId, price: x.price, compareAtPrice: x.compareAt }));
    try {
      await updatePrices(pid, req);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push(`${xs[0].title}: ${msg}`);
      await supabase.from("shopify_change_log").insert({ actor: viewer.userId, shopify_product_id: pid, shopify_product_title: xs[0].title, action: "update_prices", request: req as unknown as Json, ok: false, error: msg.slice(0, 2000) });
      continue;
    }
    await supabase.from("shopify_change_log").insert({ actor: viewer.userId, shopify_product_id: pid, shopify_product_title: xs[0].title, action: "update_prices", request: req as unknown as Json, ok: true });
    for (const x of xs) {
      await supabase
        .from("vendor_variant_links")
        .update({ shopify_price: x.price, shopify_compare_at: x.compareAt, shopify_seen_at: now, status: "approved", reviewed_by: viewer.userId, reviewed_at: now })
        .eq("id", x.linkId)
        .neq("status", "no_match");
      count++;
    }
  }
  revalidatePath(PATH);
  return { error: failed.length ? `Some listings failed: ${failed.slice(0, 3).join(" · ")}` : null, count, failed };
}

/** "We don't sell this" for several options at once (e.g. a whole attempt). */
export async function ignoreOptions(pid: number, siteId: string, slug: string, variantIds: string[], note: string): Promise<{ error: string | null }> {
  const viewer = await gate();
  if (!viewer) return { error: DENIED };
  const supabase = await createClient();
  const { error } = await supabase.from("listing_gap_decisions").upsert(
    variantIds.map((v) => ({ shopify_product_id: pid, vendor_site_id: siteId, product_slug: slug, variant_id: v, decision: "ignore", note: note.trim() || null, decided_by: viewer.userId })),
    { onConflict: "shopify_product_id,vendor_site_id,product_slug,variant_id" },
  );
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { error: null };
}

type Plan = {
  approve: number[];
  siblings: { pid: number; site: string; slug: string; title: string; attempts: string }[];
  alternatives: { pid: number; vid: number; site: string; slug: string; title: string; attempts: string; bvid: string; blabel: string; bprice: number | null }[];
};

/** One-off loader for prepared approvals / sibling products / attempt alternatives (super admin). */
export async function importPlan(json: string): Promise<{ error: string | null; count?: number }> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") return { error: "Only a super admin can load this." };
  let plan: Plan;
  try {
    plan = JSON.parse(json);
  } catch {
    return { error: "Not JSON." };
  }
  const supabase = await createClient();
  const { data: sites } = await supabase.from("vendor_sites").select("id, name");
  const sid = new Map((sites ?? []).map((s) => [s.name.toLowerCase(), s.id]));
  const now = new Date().toISOString();
  let count = 0;

  for (let i = 0; i < plan.approve.length; i += 200) {
    const { data, error } = await supabase
      .from("vendor_variant_links")
      .update({ status: "approved", reviewed_by: viewer.userId, reviewed_at: now, review_note: "Auto-approved: price matches the BB rule and only one BB product/attempt fits." })
      .in("shopify_variant_id", plan.approve.slice(i, i + 200))
      .eq("status", "suggested")
      .select("id");
    if (error) return { error: error.message, count };
    count += data?.length ?? 0;
  }
  const sibs = plan.siblings
    .map((s) => ({ shopify_product_id: s.pid, vendor_site_id: sid.get(s.site.toLowerCase())!, product_slug: s.slug, product_title: s.title, attempts: s.attempts }))
    .filter((s) => s.vendor_site_id);
  for (let i = 0; i < sibs.length; i += 200) {
    const { error } = await supabase.from("listing_vendor_products").upsert(sibs.slice(i, i + 200), { onConflict: "shopify_product_id,vendor_site_id,product_slug" });
    if (error) return { error: error.message, count };
  }
  const alts = plan.alternatives
    .map((a) => ({
      shopify_product_id: a.pid,
      shopify_variant_id: a.vid,
      vendor_site_id: sid.get(a.site.toLowerCase())!,
      product_slug: a.slug,
      product_title: a.title,
      attempts: a.attempts,
      vendor_variant_id: a.bvid,
      vendor_variant_label: a.blabel,
      vendor_price: a.bprice,
    }))
    .filter((a) => a.vendor_site_id);
  for (let i = 0; i < alts.length; i += 200) {
    const { error } = await supabase.from("link_alternatives").upsert(alts.slice(i, i + 200), { onConflict: "shopify_variant_id,vendor_site_id,product_slug" });
    if (error) return { error: error.message, count };
  }
  revalidatePath(PATH);
  return { error: null, count };
}
