"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { planAttempt } from "@/lib/price-check/attempt-plan";
import { expectedZeroinfyPrice } from "@/lib/price-check/rules";
import { ziAttempts } from "@/lib/price-check/batch-dates";
import { createVariants, deleteVariants, getProductForEdit, type NewVariant } from "@/lib/price-check/shopify-edit";
import { findSuccessors, readEdportalFeed, type Successor } from "@/lib/price-check/successor";
import { storeVendorOptions } from "@/lib/price-check/vendor-options";
import { canListOptions, readVendorProduct } from "@/lib/price-check/vendor-product";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * "BB dropped" → BB moved the course to a new page (a new attempt gets a new
 * product link on BB). Find that page, then move the listing onto it:
 *  - variants for an attempt still to come are re-linked to the matching option
 *    on the new page;
 *  - variants for an old attempt (this month or earlier, e.g. Nov 26) are
 *    replaced: the new page's attempt is added with the same options, priced by
 *    the owner's rules from the vendor's price (MRP as strike-through), and the old-attempt variants are
 *    deleted. Super admin only; every Shopify write is logged.
 * Owner, 18 Nov 2026.
 */

const PATH = "/settings/links";

const parts = (s: string | null) => (s ?? "").split(/,\s*(?=[A-Za-z .&/()-]+:)/).map((p) => p.trim());
const core = (label: string | null) =>
  parts(label)
    .filter((p) => !/^(exam|exams|attempt)\s*:/i.test(p))
    .map((p) => p.replace(/\s+/g, " ").toLowerCase())
    .sort()
    .join(" | ");
/** ₹1 below a round figure (owner, 13 Nov 2026). */
const rupee = (n: number | null) => (n == null ? null : n % 100 === 0 ? n - 1 : n);

function oldAttempt(variantTitle: string | null, now = new Date()): boolean {
  const a = ziAttempts(variantTitle);
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return a.length > 0 && a.every((x) => x <= cur);
}

async function site(supabase: Awaited<ReturnType<typeof createClient>>, siteId: string) {
  const { data } = await supabase.from("vendor_sites").select("id, name, website_url, read_method, platform_key, price_basis").eq("id", siteId).maybeSingle();
  return data;
}

export type SuccessorResult = { error: string | null; candidates?: Successor[]; siteUrl?: string };

/** Pages on the vendor's site that sell this listing's course now (best first). */
export async function findNewVendorPage(pid: number, siteId: string, oldSlug: string): Promise<SuccessorResult> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) return { error: "Only a manager or super admin can do this." };
  const supabase = await createClient();
  const s = await site(supabase, siteId);
  if (!s) return { error: "Vendor site not found." };
  if (s.read_method !== "edportal_feed" || !s.platform_key) return { error: `Calman can only search ${s.name}'s product list for course-platform sites so far.` };
  const { data: link } = await supabase
    .from("vendor_variant_links")
    .select("shopify_product_title, vendor_product_title")
    .eq("shopify_product_id", pid)
    .eq("vendor_product_slug", oldSlug)
    .limit(1)
    .maybeSingle();
  let feed;
  try {
    feed = await readEdportalFeed(s.platform_key);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const candidates = findSuccessors(feed, link?.shopify_product_title ?? "", link?.vendor_product_title ?? null, oldSlug);
  return { error: null, candidates, siteUrl: s.website_url };
}

export type MoveResult = { error: string | null; relinked?: number; added?: number; removed?: number; toPick?: number; note?: string };

/** Move the listing's links from a dropped vendor page to its new page; replace an old attempt. */
export async function moveToNewVendorPage(pid: number, siteId: string, oldSlug: string, newSlug: string): Promise<MoveResult> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") return { error: "Only a super admin can change Shopify listings." };
  const supabase = await createClient();
  const s = await site(supabase, siteId);
  if (!s || !canListOptions(s)) return { error: "Options can't be read from this vendor site." };

  // 1. Read and store the new page; add it to the listing's vendor products.
  const r = await readVendorProduct(s, newSlug);
  if (!r.ok) return { error: `Couldn't read the new page: ${r.reason}` };
  const title = r.title?.replace(/\s*[|–-]\s*(BB Virtuals|Vsmart Academy).*$/i, "") ?? newSlug;
  await storeVendorOptions(supabase, siteId, newSlug, title, r.variants);
  await supabase
    .from("listing_vendor_products")
    .upsert({ shopify_product_id: pid, vendor_site_id: siteId, product_slug: newSlug, product_title: title, attempts: title }, { onConflict: "shopify_product_id,vendor_site_id,product_slug" });
  const live = r.variants.filter((v) => v.status !== "archived" && Number(v.price ?? 0) > 0);

  // 2. The listing's links to the old page.
  const { data: links, error: le } = await supabase
    .from("vendor_variant_links")
    .select("id, shopify_variant_id, shopify_variant_title, status, vendor_product_slug, vendor_variant_id, vendor_variant_label, keep_price")
    .eq("shopify_product_id", pid)
    .eq("vendor_site_id", siteId)
    .eq("vendor_product_slug", oldSlug);
  if (le) return { error: le.message };
  if (!links?.length) return { error: "No variants of this listing are linked to the old page any more — refresh the listing." };
  const past = links.filter((l) => oldAttempt(l.shopify_variant_title));
  const current = links.filter((l) => !oldAttempt(l.shopify_variant_title));
  const now = new Date().toISOString();
  let relinked = 0;
  let toPick = 0;

  // 3. Variants for attempts still to come: same option on the new page → re-link; otherwise leave to pick.
  for (const l of current) {
    const c = live.filter((v) => core(v.title) === core(l.vendor_variant_label));
    const base = { vendor_product_slug: newSlug, vendor_product_title: title, reviewed_by: viewer.userId, reviewed_at: now };
    if (c.length === 1) {
      await supabase
        .from("vendor_variant_links")
        .update({ ...base, vendor_variant_id: c[0].id, vendor_variant_label: c[0].title.slice(0, 500), status: "approved", confidence: "high", review_note: "Moved to the vendor's new page (same option)." })
        .eq("id", l.id);
      relinked++;
    } else {
      await supabase
        .from("vendor_variant_links")
        .update({ ...base, vendor_variant_id: null, vendor_variant_label: null, status: "no_match", confidence: "low", reason: "Vendor moved this course to a new page — pick the option for this variant." })
        .eq("id", l.id);
      toPick++;
    }
  }

  // 4. Variants for an old attempt: add the new page's attempt in the same shape, then delete the old ones.
  let added = 0;
  let removed = 0;
  let note = "";
  if (past.length) {
    const plan = planAttempt(
      past.map((l) => ({ ...l, shopify_variant_id: Number(l.shopify_variant_id), status: l.status === "no_match" ? "no_match" : "approved" })),
      title,
      live.map((v) => ({ variant_id: v.id, label: v.title, price: v.price, state: "live" })),
    );
    let product;
    try {
      product = await getProductForEdit(pid);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), relinked, toPick };
    }
    if (!plan.ok) {
      note = `Old attempt not replaced automatically: ${plan.why} Use Batches & options for it.`;
    } else {
      // Don't carry the old attempt's batch text ("Nov 26 (DT Oct 2025 …)") over to the new attempt.
      const newValue = plan.newValue.replace(/\s*\(.*\)\s*$/, "").trim();
      if (newValue !== plan.newValue) note = `The new attempt is named "${newValue}" — add the batch name in Batches & options if the listing shows one.`;
      const opt = product.options[plan.attemptIndex];
      const byId = new Map(product.variants.map((v) => [v.id, v]));
      const mrp = new Map(live.map((v) => [v.id, v.mrp]));
      const already = opt && opt.values.includes(newValue);
      if (!opt) return { error: "The listing's options changed — refresh it.", relinked, toPick };
      if (!already) {
        const vs: NewVariant[] = [];
        for (const it of plan.items) {
          const b = byId.get(it.baseVariantId);
          if (!b) return { error: "The listing changed on Shopify since the last refresh — refresh it and try again.", relinked, toPick };
          // The owner's pricing rules (BB offer, Karan Kumar, Both Group…), then ₹1 below a round figure.
          const price = rupee(expectedZeroinfyPrice(it.price, product.title, s.name, pid).price)!;
          const m = rupee(mrp.get(it.vendorVariantId) ?? null);
          vs.push({ options: { ...b.selected, [opt.name]: newValue }, price, compareAtPrice: m != null && m > price ? m : null, inventoryPolicy: "CONTINUE", taxable: false, tracked: b.tracked, requiresShipping: b.requiresShipping });
        }
        let created: { id: number; title: string }[];
        try {
          created = await createVariants(pid, vs);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await supabase.from("shopify_change_log").insert({ actor: viewer.userId, shopify_product_id: pid, shopify_product_title: product.title, action: "replace_attempt", request: { oldSlug, newSlug, plan } as unknown as Json, ok: false, error: msg.slice(0, 2000) });
          return { error: msg, relinked, toPick };
        }
        added = created.length;
        await supabase.from("vendor_variant_links").upsert(
          created.map((v, i) => {
            const it = plan.items[i];
            return {
              shopify_product_id: pid,
              shopify_variant_id: v.id,
              shopify_product_title: product.title,
              shopify_product_handle: product.handle,
              shopify_variant_title: v.title,
              vendor_site_id: siteId,
              vendor_product_slug: newSlug,
              vendor_product_title: title,
              vendor_variant_id: it.vendorVariantId,
              vendor_variant_label: it.vendorLabel.slice(0, 500),
              status: "approved",
              confidence: "high",
              reason: `Replaced ${plan.baseValue} with the vendor's new page.`,
              suggested_by: "calman",
              suggested_at: now,
              reviewed_by: viewer.userId,
              reviewed_at: now,
              shopify_price: vs[i].price,
              shopify_compare_at: vs[i].compareAtPrice,
              shopify_seen_at: now,
            };
          }),
          { onConflict: "shopify_variant_id" },
        );
      }
      const oldIds = past.map((l) => Number(l.shopify_variant_id)).filter((id) => byId.has(id));
      if (oldIds.length && oldIds.length < product.variants.length + added) {
        try {
          await deleteVariants(pid, oldIds);
          removed = oldIds.length;
          await supabase.from("vendor_variant_links").delete().in("shopify_variant_id", oldIds);
          await supabase.from("link_alternatives").delete().in("shopify_variant_id", oldIds);
        } catch (e) {
          note += ` Couldn't delete the old-attempt variants: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      await supabase.from("shopify_change_log").insert({
        actor: viewer.userId,
        shopify_product_id: pid,
        shopify_product_title: product.title,
        action: "replace_attempt",
        request: { oldSlug, newSlug, from: plan.baseValue, to: newValue, added, removed: past.map((l) => ({ id: l.shopify_variant_id, title: l.shopify_variant_title })) } as unknown as Json,
        ok: true,
        error: null,
      });
    }
  }

  // 5. The old page is no longer one of the listing's vendor products.
  await supabase.from("listing_vendor_products").delete().eq("shopify_product_id", pid).eq("vendor_site_id", siteId).eq("product_slug", oldSlug);
  revalidatePath(PATH);
  return { error: null, relinked, added, removed, toPick, note: note.trim() || undefined };
}
