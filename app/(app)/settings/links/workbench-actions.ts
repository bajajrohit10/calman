"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { readEdportalProduct, type EdportalVariant } from "@/lib/price-check/edportal";
import {
  addOption,
  createVariants,
  deleteVariants,
  getProductForEdit,
  renameOptionValue,
  updateVariant,
  type ShopifyProductForEdit,
} from "@/lib/price-check/shopify-edit";
import { grantedScopes } from "@/lib/price-check/shopify";
import { storeVendorOptions } from "@/lib/price-check/vendor-options";
import { syncLinksWithShopify } from "@/lib/price-check/sync-links";
import { planAttempt } from "@/lib/price-check/attempt-plan";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * Price check: the "Batches & options" panel on a Links product card.
 *
 *  - loadWorkbench: the listing as it is on Shopify, its links, and every
 *    option of the linked vendor products (read live), so the panel can show
 *    which vendor batches the listing doesn't sell.
 *  - retargetLink: point one Zeroinfy variant at another option of the same
 *    vendor product, and approve it (the person picked it).
 *  - addToShopify: add a vendor batch to the listing on Shopify (a new option
 *    value, or a new option), then link and approve the new variants.
 *    Super admin only; logged in shopify_change_log either way.
 */

export type WorkbenchLink = {
  id: string;
  shopify_variant_id: number;
  shopify_variant_title: string | null;
  vendor_product_slug: string | null;
  vendor_variant_id: string | null;
  vendor_variant_label: string | null;
  status: string;
  vendor_site_id: string;
  reason: string | null;
  keep_price: boolean;
};

export type VendorProduct = {
  slug: string;
  title: string | null;
  /** Set for a vendor product selling the same course for another attempt (not linked yet). */
  attempts: string | null;
  sibling: boolean;
  siteId: string;
  siteName: string;
  siteUrl: string;
  variants: EdportalVariant[];
  error: string | null;
};

export type Workbench = {
  product: ShopifyProductForEdit;
  links: WorkbenchLink[];
  vendors: VendorProduct[];
  instructions: { site: string; text: string }[];
  canWrite: boolean;
  scopes: string[] | null;
  /** "We don't sell this" decisions for this listing: `${slug}|${variantId}`. */
  ignored: string[];
};

const PATH = "/settings/links";
const OWN_OPTION = "Zeroinfy-only option (not sold on BB)";

export async function loadWorkbench(productId: number): Promise<{ error: string | null; data?: Workbench }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) return { error: "Only a manager or super admin can do this." };
  const supabase = await createClient();

  let product: ShopifyProductForEdit;
  try {
    product = await getProductForEdit(productId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  // Opening the panel is also a refresh of this listing from Shopify (new / deleted variants, prices).
  await syncLinksWithShopify(supabase, product);

  const { data: links, error } = await supabase
    .from("vendor_variant_links")
    .select("id, shopify_variant_id, shopify_variant_title, vendor_product_slug, vendor_variant_id, vendor_variant_label, status, vendor_site_id, vendor_product_title, reason, keep_price")
    .eq("shopify_product_id", productId);
  if (error) return { error: error.message };

  const { data: sibs } = await supabase
    .from("listing_vendor_products")
    .select("vendor_site_id, product_slug, product_title, attempts")
    .eq("shopify_product_id", productId);
  const siteIds = [...new Set([...(links ?? []).map((l) => l.vendor_site_id), ...(sibs ?? []).map((x) => x.vendor_site_id)])];
  const { data: sites } = await supabase
    .from("vendor_sites")
    .select("id, name, website_url, read_method, instructions")
    .in("id", siteIds.length ? siteIds : ["00000000-0000-0000-0000-000000000000"]);
  const siteById = new Map((sites ?? []).map((s) => [s.id, s]));

  // Distinct vendor products the listing is linked to (edportal sites only for now).
  const seen = new Map<string, { slug: string; title: string | null; siteId: string; attempts: string | null; sibling: boolean }>();
  for (const l of links ?? []) {
    if (!l.vendor_product_slug) continue;
    const k = `${l.vendor_site_id}|${l.vendor_product_slug}`;
    if (!seen.has(k)) seen.set(k, { slug: l.vendor_product_slug, title: l.vendor_product_title, siteId: l.vendor_site_id, attempts: null, sibling: false });
  }
  for (const x of sibs ?? []) {
    const k = `${x.vendor_site_id}|${x.product_slug}`;
    if (!seen.has(k)) seen.set(k, { slug: x.product_slug, title: x.product_title, siteId: x.vendor_site_id, attempts: x.attempts, sibling: true });
  }
  const vendors: VendorProduct[] = [];
  for (const v of seen.values()) {
    const site = siteById.get(v.siteId);
    if (!site) continue;
    const base = { slug: v.slug, title: v.title, attempts: v.attempts, sibling: v.sibling, siteId: v.siteId, siteName: site.name, siteUrl: site.website_url };
    if (site.read_method !== "edportal_feed") {
      vendors.push({ ...base, variants: [], error: "Batch options can only be read for course-platform sites so far." });
      continue;
    }
    const r = await readEdportalProduct(new URL(site.website_url).origin, v.slug);
    // Keep the "Missing on Zeroinfy" snapshot in step with what the panel shows.
    if (r.ok) await storeVendorOptions(supabase, v.siteId, v.slug, v.title, r.variants);
    vendors.push({ ...base, variants: r.ok ? r.variants : [], error: r.ok ? null : r.reason });
  }

  const { data: dec } = await supabase.from("listing_gap_decisions").select("product_slug, variant_id").eq("shopify_product_id", productId);
  return {
    error: null,
    data: {
      ignored: (dec ?? []).map((d) => `${d.product_slug}|${d.variant_id}`),
      product,
      links: (links ?? []).map(({ vendor_product_title: _t, ...l }) => l),
      vendors,
      instructions: (sites ?? []).filter((s) => s.instructions).map((s) => ({ site: s.name, text: s.instructions! })),
      canWrite: viewer.profile.role === "super_admin",
      scopes: await grantedScopes().catch(() => null),
    },
  };
}

export async function retargetLink(
  linkId: string,
  slug: string,
  vendorVariantId: string,
  vendorVariantLabel: string,
  vendorProductTitle: string | null,
): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) return { error: "Only a manager or super admin can do this." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_variant_links")
    .update({
      vendor_product_slug: slug,
      vendor_product_title: vendorProductTitle,
      vendor_variant_id: vendorVariantId,
      vendor_variant_label: vendorVariantLabel.slice(0, 500),
      status: "approved",
      confidence: "high",
      reviewed_by: viewer.userId,
      reviewed_at: new Date().toISOString(),
      review_note: "Option chosen by hand in Batches & options.",
    })
    .eq("id", linkId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That link was not found." };
  revalidatePath(PATH);
  return { error: null };
}

export type AddPlan = {
  productId: number;
  siteId: string;
  slug: string;
  vendorProductTitle: string | null;
  vendorVariantId: string;
  vendorVariantLabel: string;
  /** Existing option to add a value to, or a new option to create. */
  target: { kind: "existing"; option: string } | { kind: "new"; option: string; existingValue: string };
  newValue: string;
  /** For every other option, the values to combine the new value with. */
  combine: Record<string, string[]>;
  price: number;
  compareAtPrice: number | null;
};

export async function addToShopify(plan: AddPlan): Promise<{ error: string | null; count?: number }> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") return { error: "Only a super admin can change Shopify listings." };
  const supabase = await createClient();

  const fail = async (msg: string, product?: ShopifyProductForEdit) => {
    await supabase.from("shopify_change_log").insert({
      actor: viewer.userId,
      shopify_product_id: plan.productId,
      shopify_product_title: product?.title ?? null,
      action: "add_variants",
      request: plan as unknown as Json,
      ok: false,
      error: msg.slice(0, 2000),
    });
    return { error: msg };
  };

  const newValue = plan.newValue.trim();
  if (!newValue || newValue.length > 255) return { error: "Give the new option value a name (max 255 characters)." };
  if (!(plan.price > 0) || plan.price > 1_000_000) return { error: "Enter a sensible price." };
  if (plan.compareAtPrice != null && plan.compareAtPrice < plan.price) return { error: "Compare-at price can't be below the price." };

  // Re-read the listing: the plan must still fit what's on Shopify now.
  let product: ShopifyProductForEdit;
  try {
    product = await getProductForEdit(plan.productId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const optionNames = product.options.map((o) => o.name);
  const targetName = plan.target.option.trim();
  if (plan.target.kind === "existing" && !optionNames.includes(targetName)) return { error: `The listing has no option "${targetName}" any more — reload.` };
  if (plan.target.kind === "new") {
    if (!targetName) return { error: "Name the new option." };
    if (optionNames.includes(targetName)) return { error: `The listing already has an option "${targetName}".` };
    if (product.options.length >= 3) return { error: "Shopify allows at most 3 options — add the batch as a value of an existing option instead." };
    if (!plan.target.existingValue.trim()) return { error: "Name what the current variants should be called in the new option." };
    if (plan.target.existingValue.trim() === newValue) return { error: "The new batch needs a different name from the current one." };
  }
  if (plan.target.kind === "existing" && product.options.find((o) => o.name === targetName)!.values.includes(newValue)) {
    return { error: `"${newValue}" is already a value of ${targetName}.` };
  }

  // Combinations of the other options.
  const others = optionNames.filter((n) => n !== targetName);
  let combos: Record<string, string>[] = [{}];
  for (const name of others) {
    const vals = (plan.combine[name] ?? []).filter((v) => product.options.find((o) => o.name === name)!.values.includes(v));
    if (!vals.length) return { error: `Pick at least one value of ${name}.` };
    combos = combos.flatMap((c) => vals.map((v) => ({ ...c, [name]: v })));
  }
  if (product.variants.length + combos.length > 2048) return { error: "That would exceed Shopify's 2,048 variants per product." };

  // Copy stock/tax settings from an existing variant with the same other options.
  const sibling = (c: Record<string, string>) =>
    product.variants.find((v) => others.every((n) => v.selected[n] === c[n])) ?? product.variants[0];

  const variants = combos.map((c) => {
    const s = sibling(c);
    return {
      options: { ...c, [targetName]: newValue },
      price: plan.price,
      compareAtPrice: plan.compareAtPrice,
      inventoryPolicy: s.inventoryPolicy,
      taxable: s.taxable,
      tracked: s.tracked,
      requiresShipping: s.requiresShipping,
    };
  });

  let created: { id: number; title: string }[];
  try {
    if (plan.target.kind === "new") await addOption(plan.productId, targetName, plan.target.existingValue.trim());
    created = await createVariants(plan.productId, variants);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), product);
  }

  await supabase.from("shopify_change_log").insert({
    actor: viewer.userId,
    shopify_product_id: plan.productId,
    shopify_product_title: product.title,
    action: "add_variants",
    request: plan as unknown as Json,
    result: { created } as unknown as Json,
    ok: true,
  });

  // Link the new variants, approved: a person chose this exact vendor option.
  const now = new Date().toISOString();
  const { error: linkErr } = await supabase.from("vendor_variant_links").upsert(
    created.map((v) => ({
      shopify_product_id: plan.productId,
      shopify_variant_id: v.id,
      shopify_product_title: product.title,
      shopify_product_handle: product.handle,
      shopify_vendor: null,
      shopify_variant_title: v.title,
      vendor_site_id: plan.siteId,
      vendor_product_slug: plan.slug,
      vendor_product_title: plan.vendorProductTitle,
      vendor_variant_id: plan.vendorVariantId,
      vendor_variant_label: plan.vendorVariantLabel.slice(0, 500),
      status: "approved",
      confidence: "high",
      reason: "Added to the listing from Calman to match this vendor option.",
      suggested_by: "calman",
      suggested_at: now,
      reviewed_by: viewer.userId,
      reviewed_at: now,
    })),
    { onConflict: "shopify_variant_id" },
  );

  // A new option renames every existing variant ("… / Batch 2"): refresh the snapshot titles.
  if (plan.target.kind === "new") {
    try {
      const after = await getProductForEdit(plan.productId);
      for (const v of after.variants) {
        await supabase.from("vendor_variant_links").update({ shopify_variant_title: v.title }).eq("shopify_variant_id", v.id);
      }
    } catch {
      // Titles are display-only; the next import refreshes them.
    }
  }

  revalidatePath(PATH);
  if (linkErr) return { error: `Added ${created.length} variants on Shopify, but linking them failed: ${linkErr.message}`, count: created.length };
  return { error: null, count: created.length };
}

/* ------------------------------------------------- edit / remove variants -- */

/** "Zeroinfy-only option": BB doesn't sell it (e.g. without books); keep it, no price check. */
export async function markOwnOption(linkId: string, slug: string, productTitle: string | null): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) return { error: "Only a manager or super admin can do this." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_variant_links")
    .update({
      vendor_product_slug: slug,
      vendor_product_title: productTitle,
      vendor_variant_id: null,
      vendor_variant_label: OWN_OPTION,
      status: "approved",
      confidence: "high",
      keep_price: true,
      reviewed_by: viewer.userId,
      reviewed_at: new Date().toISOString(),
      review_note: "Zeroinfy-only option, kept by hand: not sold on BB, price not checked.",
    })
    .eq("id", linkId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That link was not found." };
  revalidatePath(PATH);
  return { error: null };
}

/** Paste a BB product link: add that product to this listing's choices in Batches & options. */
export async function addVendorProductByUrl(productId: number, link: string): Promise<{ error: string | null; title?: string }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) return { error: "Only a manager or super admin can do this." };
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return { error: "That isn't a link. Copy the product page address from bbvirtuals.com." };
  }
  const m = u.pathname.match(/\/product\/([^/?#]+)/);
  if (!m) return { error: "That isn't a product page (the address should contain /product/…)." };
  const slug = decodeURIComponent(m[1]);
  const host = u.hostname.replace(/^www\./, "");
  const supabase = await createClient();
  const { data: sites } = await supabase.from("vendor_sites").select("id, name, website_url, read_method");
  const site = (sites ?? []).find((s) => {
    try {
      return new URL(s.website_url).hostname.replace(/^www\./, "") === host;
    } catch {
      return false;
    }
  });
  if (!site) return { error: `${host} isn't one of the vendor sites in Settings → Vendors.` };
  if (site.read_method !== "edportal_feed") return { error: `Options can't be read from ${site.name} yet.` };
  const r = await readEdportalProduct(new URL(site.website_url).origin, slug);
  if (!r.ok) return { error: `Couldn't read that page: ${r.reason}` };
  const title = r.title?.replace(/\s*[|–-]\s*BB Virtuals.*$/i, "") ?? slug;
  await storeVendorOptions(supabase, site.id, slug, title, r.variants);
  const { error } = await supabase
    .from("listing_vendor_products")
    .upsert({ shopify_product_id: productId, vendor_site_id: site.id, product_slug: slug, product_title: title, attempts: "added by hand" }, { onConflict: "shopify_product_id,vendor_site_id,product_slug" });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { error: null, title };
}

/**
 * "Which BB product?" answered with a pasted link: point these variants at that
 * product and leave each one to be matched to its BB option in Batches & options.
 */
export async function linkPastedProduct(productId: number, link: string, variantIds: number[]): Promise<{ error: string | null; title?: string; count?: number }> {
  const added = await addVendorProductByUrl(productId, link);
  if (added.error) return added;
  const supabase = await createClient();
  const m = link.match(/\/product\/([^/?#]+)/)!;
  const slug = decodeURIComponent(m[1]);
  const { data: lvp } = await supabase.from("listing_vendor_products").select("vendor_site_id").eq("shopify_product_id", productId).eq("product_slug", slug).limit(1);
  const siteId = lvp?.[0]?.vendor_site_id;
  if (!siteId) return { error: "Couldn't store that product." };
  const { data, error } = await supabase
    .from("vendor_variant_links")
    .update({
      vendor_site_id: siteId,
      vendor_product_slug: slug,
      vendor_product_title: added.title ?? slug,
      vendor_variant_id: null,
      vendor_variant_label: null,
      status: "no_match",
      confidence: "low",
      reason: "BB product chosen by hand — pick the BB option for this variant.",
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
    })
    .eq("shopify_product_id", productId)
    .in("shopify_variant_id", variantIds.length ? variantIds : [-1])
    .select("id");
  if (error) return { error: error.message };
  await supabase.from("link_alternatives").delete().eq("shopify_product_id", productId).in("shopify_variant_id", variantIds.length ? variantIds : [-1]);
  revalidatePath(PATH);
  return { error: null, title: added.title, count: data?.length ?? 0 };
}

/**
 * Add another attempt that BB sells as a separate product, copying the options of an
 * attempt already on the listing, at BB's prices — only when planAttempt finds no doubt.
 */
export async function addAttemptAuto(productId: number, siteId: string, slug: string): Promise<{ error: string | null; count?: number; value?: string }> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") return { error: "Only a super admin can change Shopify listings." };
  const supabase = await createClient();
  const [{ data: links }, { data: sib }, { data: opts }] = await Promise.all([
    supabase.from("vendor_variant_links").select("shopify_variant_id, shopify_variant_title, status, vendor_product_slug, vendor_variant_id, vendor_variant_label, keep_price").eq("shopify_product_id", productId),
    supabase.from("listing_vendor_products").select("product_title, attempts").eq("shopify_product_id", productId).eq("vendor_site_id", siteId).eq("product_slug", slug).maybeSingle(),
    supabase.from("vendor_options").select("variant_id, label, price, state").eq("vendor_site_id", siteId).eq("product_slug", slug),
  ]);
  const plan = planAttempt(
    (links ?? []).map((l) => ({ ...l, shopify_variant_id: Number(l.shopify_variant_id) })),
    sib?.attempts ?? null,
    (opts ?? []).map((o) => ({ ...o, price: o.price == null ? null : Number(o.price) })),
  );
  if (!plan.ok) return { error: plan.why };

  let product: ShopifyProductForEdit;
  try {
    product = await getProductForEdit(productId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const opt = product.options[plan.attemptIndex];
  if (!opt) return { error: "The listing's options changed — refresh it." };
  if (opt.values.includes(plan.newValue)) return { error: `"${plan.newValue}" is already on the listing.` };
  const byId = new Map(product.variants.map((v) => [v.id, v]));
  const variants = [];
  for (const it of plan.items) {
    const b = byId.get(it.baseVariantId);
    if (!b || b.selected[opt.name] !== plan.baseValue) return { error: "The listing changed on Shopify since the last refresh — refresh it and try again." };
    variants.push({
      options: { ...b.selected, [opt.name]: plan.newValue },
      price: it.price,
      compareAtPrice: null,
      inventoryPolicy: b.inventoryPolicy,
      taxable: b.taxable,
      tracked: b.tracked,
      requiresShipping: b.requiresShipping,
    });
  }
  if (product.variants.length + variants.length > 2048) return { error: "That would exceed Shopify's 2,048 variants per product." };

  let created: { id: number; title: string }[];
  try {
    created = await createVariants(productId, variants);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logChange(supabase, viewer.userId, productId, product.title, "add_attempt", { slug, plan }, false, msg);
    return { error: msg };
  }
  await logChange(supabase, viewer.userId, productId, product.title, "add_attempt", { slug, plan, created }, true);

  const now = new Date().toISOString();
  const { error: linkErr } = await supabase.from("vendor_variant_links").upsert(
    created.map((v, i) => {
      const it = plan.items.find((x) => x.newTitle === v.title) ?? plan.items[i];
      return {
      shopify_product_id: productId,
      shopify_variant_id: v.id,
      shopify_product_title: product.title,
      shopify_product_handle: product.handle,
      shopify_variant_title: v.title,
      vendor_site_id: siteId,
      vendor_product_slug: slug,
      vendor_product_title: sib?.product_title ?? null,
      vendor_variant_id: it.vendorVariantId,
      vendor_variant_label: it.vendorLabel.slice(0, 500),
      status: "approved",
      confidence: "high",
      reason: `Added automatically: same options as "${plan.baseValue}", at BB's ${sib?.attempts ?? ""} prices.`,
      suggested_by: "calman",
      suggested_at: now,
      reviewed_by: viewer.userId,
      reviewed_at: now,
      shopify_price: it.price,
      shopify_seen_at: now,
      };
    }),
    { onConflict: "shopify_variant_id" },
  );
  revalidatePath(PATH);
  if (linkErr) return { error: `Added ${created.length} variants on Shopify, but linking them failed: ${linkErr.message}`, count: created.length };
  return { error: null, count: created.length, value: plan.newValue };
}

async function superAdmin() {
  const viewer = await requireUser();
  return viewer.profile?.role === "super_admin" ? viewer : null;
}

async function logChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actor: string | null,
  pid: number,
  title: string | null,
  action: string,
  request: unknown,
  ok: boolean,
  error?: string,
) {
  await supabase.from("shopify_change_log").insert({
    actor,
    shopify_product_id: pid,
    shopify_product_title: title,
    action,
    request: request as Json,
    ok,
    error: error?.slice(0, 2000) ?? null,
  });
}

/** Snapshot titles/prices of a listing's links after a change on Shopify. */
async function resnapshot(supabase: Awaited<ReturnType<typeof createClient>>, pid: number) {
  try {
    const p = await getProductForEdit(pid);
    const now = new Date().toISOString();
    for (const v of p.variants) {
      await supabase
        .from("vendor_variant_links")
        .update({ shopify_variant_title: v.title, shopify_price: v.price, shopify_compare_at: v.compareAtPrice, shopify_seen_at: now })
        .eq("shopify_variant_id", v.id);
    }
  } catch {
    // display-only
  }
}

/** Delete variants on Shopify (super admin), and their links. */
export async function removeVariants(productId: number, variantIds: number[]): Promise<{ error: string | null; count?: number }> {
  const viewer = await superAdmin();
  if (!viewer) return { error: "Only a super admin can remove variants." };
  if (!variantIds.length) return { error: null, count: 0 };
  const supabase = await createClient();
  let product: ShopifyProductForEdit;
  try {
    product = await getProductForEdit(productId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const ids = variantIds.filter((v) => product.variants.some((x) => x.id === v));
  if (ids.length >= product.variants.length) return { error: "That would remove every variant — a Shopify listing needs at least one. Archive the product in Shopify instead." };
  try {
    await deleteVariants(productId, ids);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logChange(supabase, viewer.userId, productId, product.title, "delete_variants", { variantIds: ids }, false, msg);
    return { error: msg };
  }
  await logChange(supabase, viewer.userId, productId, product.title, "delete_variants", {
    variants: product.variants.filter((v) => ids.includes(v.id)).map((v) => ({ id: v.id, title: v.title, price: v.price })),
  }, true);
  await supabase.from("vendor_variant_links").delete().in("shopify_variant_id", ids);
  await supabase.from("link_alternatives").delete().in("shopify_variant_id", ids);
  revalidatePath(PATH);
  return { error: null, count: ids.length };
}

/** Change one variant's price / compare-at / option values on Shopify (super admin). */
export async function editVariant(
  productId: number,
  variantId: number,
  change: { price: number; compareAtPrice: number | null; options: Record<string, string> },
): Promise<{ error: string | null }> {
  const viewer = await superAdmin();
  if (!viewer) return { error: "Only a super admin can edit variants." };
  if (!(change.price > 0)) return { error: "Enter a price." };
  if (change.compareAtPrice != null && change.compareAtPrice < change.price) return { error: "Compare-at can't be below the price." };
  const supabase = await createClient();
  let product: ShopifyProductForEdit;
  try {
    product = await getProductForEdit(productId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const v = product.variants.find((x) => x.id === variantId);
  if (!v) return { error: "That variant is no longer on Shopify — reload." };
  const options: Record<string, string> = {};
  for (const o of product.options) {
    const val = (change.options[o.name] ?? v.selected[o.name] ?? "").trim();
    if (!val) return { error: `Give ${o.name} a value.` };
    options[o.name] = val;
  }
  const optsChanged = product.options.some((o) => options[o.name] !== v.selected[o.name]);
  if (optsChanged && product.variants.some((x) => x.id !== v.id && product.options.every((o) => x.selected[o.name] === options[o.name]))) {
    return { error: "Another variant already has exactly these options." };
  }
  const req = { variantId, from: { price: v.price, compareAt: v.compareAtPrice, options: v.selected }, to: { price: change.price, compareAt: change.compareAtPrice, options } };
  try {
    await updateVariant(productId, variantId, { price: change.price, compareAtPrice: change.compareAtPrice, options: optsChanged ? options : undefined });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logChange(supabase, viewer.userId, productId, product.title, "edit_variant", req, false, msg);
    return { error: msg };
  }
  await logChange(supabase, viewer.userId, productId, product.title, "edit_variant", req, true);
  if (optsChanged) {
    // A new attempt/batch: the old vendor link no longer holds — pick the BB option again.
    await supabase
      .from("vendor_variant_links")
      .update({ status: "no_match", vendor_product_slug: null, vendor_variant_id: null, vendor_variant_label: null, reason: "Options changed in Calman — pick the BB option in Batches & options." })
      .eq("shopify_variant_id", variantId);
  }
  await resnapshot(supabase, productId);
  revalidatePath(PATH);
  return { error: null };
}

/** Rename an option value on every variant (e.g. "May-26" → "May-27"), super admin. */
export async function renameValue(productId: number, optionName: string, from: string, to: string): Promise<{ error: string | null }> {
  const viewer = await superAdmin();
  if (!viewer) return { error: "Only a super admin can rename options." };
  const name = to.trim();
  if (!name) return { error: "Enter the new name." };
  const supabase = await createClient();
  let product: ShopifyProductForEdit;
  try {
    product = await getProductForEdit(productId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const o = product.options.find((x) => x.name === optionName);
  const valueId = o?.valueIds[from];
  if (!o || !valueId) return { error: "That option value is no longer on the listing — reload." };
  if (o.values.includes(name)) return { error: `"${name}" already exists in ${optionName}.` };
  const req = { option: optionName, from, to: name };
  try {
    await renameOptionValue(productId, o.id, valueId, name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logChange(supabase, viewer.userId, productId, product.title, "rename_option_value", req, false, msg);
    return { error: msg };
  }
  await logChange(supabase, viewer.userId, productId, product.title, "rename_option_value", req, true);
  const affected = product.variants.filter((v) => v.selected[optionName] === from).map((v) => v.id);
  if (affected.length) {
    await supabase
      .from("vendor_variant_links")
      .update({ status: "no_match", vendor_product_slug: null, vendor_variant_id: null, vendor_variant_label: null, reason: `Renamed ${from} → ${name} in Calman — pick the BB option in Batches & options.` })
      .in("shopify_variant_id", affected);
  }
  await resnapshot(supabase, productId);
  revalidatePath(PATH);
  return { error: null };
}
