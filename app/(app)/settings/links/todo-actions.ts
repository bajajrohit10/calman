"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { getProductForEdit, updatePrices } from "@/lib/price-check/shopify-edit";
import { syncLinksWithShopify } from "@/lib/price-check/sync-links";
import { readEdportalProduct } from "@/lib/price-check/edportal";
import { storeVendorOptions } from "@/lib/price-check/vendor-options";
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
      await syncLinksWithShopify(supabase, p);
    }),
  );
  return { error: null, failed };
}

/** Refresh one listing: re-read it from Shopify and re-read every BB product it links to. */
export async function refreshListing(pid: number): Promise<{ error: string | null; count?: number }> {
  const r = await refreshShopify([pid]);
  if (r.error) return r;
  const supabase = await createClient();
  const [{ data: links }, { data: sibs }, { data: sites }] = await Promise.all([
    supabase.from("vendor_variant_links").select("vendor_site_id, vendor_product_slug, vendor_product_title").eq("shopify_product_id", pid).not("vendor_product_slug", "is", null),
    supabase.from("listing_vendor_products").select("vendor_site_id, product_slug, product_title").eq("shopify_product_id", pid),
    supabase.from("vendor_sites").select("id, website_url, read_method"),
  ]);
  const url = new Map((sites ?? []).filter((s) => s.read_method === "edportal_feed").map((s) => [s.id, s.website_url]));
  const seen = new Map<string, { siteId: string; slug: string; title: string | null }>();
  for (const l of links ?? []) seen.set(`${l.vendor_site_id}|${l.vendor_product_slug}`, { siteId: l.vendor_site_id, slug: l.vendor_product_slug!, title: l.vendor_product_title });
  for (const x of sibs ?? []) seen.set(`${x.vendor_site_id}|${x.product_slug}`, { siteId: x.vendor_site_id, slug: x.product_slug, title: x.product_title });
  const failed = [...(r.failed ?? [])];
  let count = 0;
  await Promise.all(
    [...seen.values()].map(async (it) => {
      const base = url.get(it.siteId);
      if (!base) return;
      const v = await readEdportalProduct(new URL(base).origin, it.slug);
      if (!v.ok) {
        if (/HTTP 404|No variant data/.test(v.reason)) await storeVendorOptions(supabase, it.siteId, it.slug, it.title, []);
        failed.push(`${it.title ?? it.slug}: ${v.reason}`);
        return;
      }
      await storeVendorOptions(supabase, it.siteId, it.slug, it.title, v.variants);
      count++;
    }),
  );
  revalidatePath(PATH);
  return failed.length ? { error: `Refreshed, but couldn't read: ${failed.join(" · ")}`, count } : { error: null, count };
}

/** "Keep our price": leave this variant out of "Price to fix" (or put it back). */
export async function setKeepPrice(linkIds: string[], keep: boolean, note: string): Promise<{ error: string | null; count?: number }> {
  const viewer = await gate();
  if (!viewer) return { error: DENIED };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_variant_links")
    .update(keep ? { keep_price: true, review_note: note.trim() ? `Keep our price: ${note.trim()}` : "Keep our price (set by hand)." } : { keep_price: false })
    .in("id", linkIds.length ? linkIds : ["00000000-0000-0000-0000-000000000000"])
    .select("id");
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { error: null, count: data?.length ?? 0 };
}

/** "It's May 27": re-link every variant of the listing to that vendor product, approved. */
export async function answerAttempt(pid: number, siteId: string, slug: string, variantIds: number[]): Promise<{ error: string | null; count?: number }> {
  const viewer = await gate();
  if (!viewer) return { error: DENIED };
  const supabase = await createClient();
  const { data: alts, error } = await supabase
    .from("link_alternatives")
    .select("shopify_variant_id, product_title, vendor_variant_id, vendor_variant_label")
    .eq("shopify_product_id", pid)
    .eq("vendor_site_id", siteId)
    .eq("product_slug", slug)
    .in("shopify_variant_id", variantIds.length ? variantIds : [-1]);
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
        review_note: "BB product chosen in To do on Zeroinfy.",
        reviewed_by: viewer.userId,
        reviewed_at: now,
      })
      .eq("shopify_variant_id", a.shopify_variant_id)
      .select("id");
    count += data?.length ?? 0;
  }
  await supabase.from("link_alternatives").delete().eq("shopify_product_id", pid).in("shopify_variant_id", alts.map((a) => a.shopify_variant_id));
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
  /** Re-point these variants to a vendor option and approve (resolved by me offline). */
  relink?: {
    vid: number;
    site: string;
    slug: string;
    title: string;
    bvid: string;
    blabel: string;
    note: string;
    /** Default approved; "suggested" puts it under "Confirm BB match". */
    status?: "approved" | "suggested";
    reason?: string;
  }[];
  /** Variants whose current link was chosen by price: put back to "suggested" and ask. */
  ask?: number[];
  /** Sibling BB products added earlier that should be removed again. */
  unsiblings?: { pid: number; site: string; slug: string }[];
  /** Delete every stored alternative before loading the new ones. */
  replaceAlternatives?: boolean;
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
  for (const r of plan.relink ?? []) {
    const site = sid.get(r.site.toLowerCase());
    if (!site) continue;
    const { data } = await supabase
      .from("vendor_variant_links")
      .update(
        r.status === "suggested"
          ? { vendor_site_id: site, vendor_product_slug: r.slug, vendor_product_title: r.title, vendor_variant_id: r.bvid, vendor_variant_label: r.blabel, status: "suggested", confidence: "medium", reason: r.reason ?? r.note, review_note: null, reviewed_by: null, reviewed_at: null }
          : { vendor_site_id: site, vendor_product_slug: r.slug, vendor_product_title: r.title, vendor_variant_id: r.bvid, vendor_variant_label: r.blabel, status: "approved", confidence: "high", reviewed_by: viewer.userId, reviewed_at: now, review_note: r.note },
      )
      .eq("shopify_variant_id", r.vid)
      .not("status", "in", r.status === "suggested" ? '("approved","rejected")' : '("rejected")')
      .select("id");
    count += data?.length ?? 0;
  }
  for (let i = 0; i < (plan.ask ?? []).length; i += 200) {
    const { data, error } = await supabase
      .from("vendor_variant_links")
      .update({ status: "suggested", confidence: "low", reason: "More than one BB product matches by name — please choose which one this variant resells.", review_note: null, reviewed_by: null, reviewed_at: null })
      .in("shopify_variant_id", plan.ask!.slice(i, i + 200))
      .like("review_note", "%only this one matches the Zeroinfy price%")
      .select("id");
    if (error) return { error: error.message, count };
    count += data?.length ?? 0;
  }
  for (const u of plan.unsiblings ?? []) {
    const site = sid.get(u.site.toLowerCase());
    if (!site) continue;
    await supabase.from("listing_vendor_products").delete().eq("shopify_product_id", u.pid).eq("vendor_site_id", site).eq("product_slug", u.slug);
    await supabase.from("link_alternatives").delete().eq("shopify_product_id", u.pid).eq("vendor_site_id", site).eq("product_slug", u.slug);
  }
  if (plan.replaceAlternatives) {
    const { error } = await supabase.from("link_alternatives").delete().gte("shopify_product_id", 0);
    if (error) return { error: error.message, count };
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

/** "None of these": drop the suggested choices for these variants (they stay unmatched). */
export async function dismissChoices(pid: number, variantIds: number[]): Promise<{ error: string | null }> {
  if (!(await gate())) return { error: DENIED };
  const supabase = await createClient();
  const { error } = await supabase.from("link_alternatives").delete().eq("shopify_product_id", pid).in("shopify_variant_id", variantIds.length ? variantIds : [-1]);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { error: null };
}
