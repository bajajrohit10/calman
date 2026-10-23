"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { readProductPrice, type ReadMethod, type ReadResult, type PriceBasis } from "@/lib/price-check/readers";
import { createClient } from "@/lib/supabase/server";

/**
 * Price check, Brief 1. Settings → Vendors.
 *
 * Every action re-checks the role here AND relies on admin-only RLS. Hiding
 * the tab is presentation; this is the permission. A counsellor calling one of
 * these directly gets the refusal below, and if that check were ever lost the
 * insert/update/select policies would still deny them.
 */

export type VendorResult = { error: string | null };

const DENIED = "Only a manager or super admin can change vendor settings.";
const PATH = "/settings/vendors";

const METHODS: ReadMethod[] = ["edportal_feed", "shopify_feed", "vsmart_page", "letscommerce_page", "manual"];
const BASES: PriceBasis[] = ["listed", "after_auto_coupon"];
const STATUSES = ["working", "blocked", "needs_review", "manual"] as const;

async function gate(): Promise<string | null> {
  const viewer = await requireUser();
  return viewer.profile && isAdmin(viewer.profile.role) ? null : DENIED;
}

export type SitePatch = {
  name?: string;
  website_url?: string;
  read_method?: string;
  platform_key?: string | null;
  price_basis?: string;
  status?: string;
  notes?: string | null;
  instructions?: string | null;
  is_active?: boolean;
};

function cleanPatch(p: SitePatch): { patch: SitePatch; error: string | null } {
  const out: SitePatch = {};
  if (p.name !== undefined) {
    if (!p.name.trim()) return { patch: out, error: "A site needs a name." };
    out.name = p.name.trim();
  }
  if (p.website_url !== undefined) {
    const u = p.website_url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^/\s]+/i.test(u)) return { patch: out, error: "Website must start with https://" };
    out.website_url = u;
  }
  if (p.read_method !== undefined) {
    if (!METHODS.includes(p.read_method as ReadMethod)) return { patch: out, error: "Unknown read method." };
    out.read_method = p.read_method;
  }
  if (p.price_basis !== undefined) {
    if (!BASES.includes(p.price_basis as PriceBasis)) return { patch: out, error: "Unknown price basis." };
    out.price_basis = p.price_basis;
  }
  if (p.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(p.status)) return { patch: out, error: "Unknown status." };
    out.status = p.status;
  }
  if (p.platform_key !== undefined) out.platform_key = p.platform_key?.trim() || null;
  if (p.notes !== undefined) out.notes = p.notes?.trim() || null;
  if (p.instructions !== undefined) {
    const v = p.instructions?.trim() || null;
    if (v && v.length > 5000) return { patch: out, error: "Instructions are limited to 5,000 characters." };
    out.instructions = v;
  }
  if (p.is_active !== undefined) out.is_active = p.is_active;
  return { patch: out, error: null };
}

export async function addSite(input: { name: string; website_url: string }): Promise<VendorResult> {
  const denied = await gate();
  if (denied) return { error: denied };
  const { patch, error } = cleanPatch({ name: input.name, website_url: input.website_url });
  if (error) return { error };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const { error: dbError } = await supabase.from("vendor_sites").insert({
    name: patch.name!,
    website_url: patch.website_url!,
    read_method: "manual",
    status: "needs_review",
    created_by: typeof auth?.claims?.sub === "string" ? auth.claims.sub : null,
  });
  if (dbError) return { error: dbError.code === "23505" ? "A site with that name already exists." : dbError.message };
  revalidatePath(PATH);
  return { error: null };
}

export async function updateSite(id: string, input: SitePatch): Promise<VendorResult> {
  const denied = await gate();
  if (denied) return { error: denied };
  const { patch, error } = cleanPatch(input);
  if (error) return { error };
  if (Object.keys(patch).length === 0) return { error: null };

  const supabase = await createClient();
  const { data, error: dbError } = await supabase.from("vendor_sites").update(patch).eq("id", id).select("id");
  if (dbError) {
    if (dbError.code === "23505") return { error: "A site with that name already exists." };
    if (dbError.code === "23514") return { error: "That combination is not allowed (an edportal feed needs a platform key)." };
    return { error: dbError.message };
  }
  // RLS turns a forbidden update into zero rows, not an error. Say so.
  if (!data?.length) return { error: "Nothing was updated — the site was not found or you lack access." };
  revalidatePath(PATH);
  return { error: null };
}

export async function addAlias(siteId: string, shopifyVendor: string): Promise<VendorResult> {
  const denied = await gate();
  if (denied) return { error: denied };
  const name = shopifyVendor.trim();
  if (!name) return { error: "Pick a Shopify vendor name." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const { error } = await supabase.from("vendor_site_aliases").insert({
    vendor_site_id: siteId,
    shopify_vendor: name,
    created_by: typeof auth?.claims?.sub === "string" ? auth.claims.sub : null,
  });
  if (error) return { error: error.code === "23505" ? "That name is already on this site." : error.message };
  revalidatePath(PATH);
  return { error: null };
}

export async function removeAlias(aliasId: string): Promise<VendorResult> {
  const denied = await gate();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { data, error } = await supabase.from("vendor_site_aliases").delete().eq("id", aliasId).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Nothing was removed — the name was not found or you lack access." };
  revalidatePath(PATH);
  return { error: null };
}

export async function addExclusion(shopifyVendor: string, reason: string): Promise<VendorResult> {
  const denied = await gate();
  if (denied) return { error: denied };
  const name = shopifyVendor.trim();
  if (!name) return { error: "Pick a Shopify vendor name." };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const { error } = await supabase.from("price_check_excluded_vendors").insert({
    shopify_vendor: name,
    reason: reason.trim() || null,
    created_by: typeof auth?.claims?.sub === "string" ? auth.claims.sub : null,
  });
  if (error) return { error: error.code === "23505" ? "That name is already excluded." : error.message };
  revalidatePath(PATH);
  return { error: null };
}

export async function removeExclusion(id: string): Promise<VendorResult> {
  const denied = await gate();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { data, error } = await supabase.from("price_check_excluded_vendors").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Nothing was removed — the name was not found or you lack access." };
  revalidatePath(PATH);
  return { error: null };
}

/**
 * Read one product's price from a site, now. Nothing about the price is
 * saved in this brief — only that the site was checked and what happened, so
 * the registry shows whether each site's method still works.
 */
export async function testRead(siteId: string, productUrl: string): Promise<{ error: string | null; result: ReadResult | null }> {
  const denied = await gate();
  if (denied) return { error: denied, result: null };

  const supabase = await createClient();
  const { data: site, error } = await supabase
    .from("vendor_sites")
    .select("id, website_url, read_method, platform_key, price_basis")
    .eq("id", siteId)
    .maybeSingle();
  if (error) return { error: error.message, result: null };
  if (!site) return { error: "Site not found.", result: null };

  const result = await readProductPrice(
    {
      website_url: site.website_url,
      read_method: site.read_method as ReadMethod,
      platform_key: site.platform_key,
      price_basis: site.price_basis as PriceBasis,
    },
    productUrl,
  );

  const summary = result.ok
    ? `OK — ${result.variants.length} price(s) read for "${result.title}"`
    : `Failed — ${result.reason}`;
  await supabase
    .from("vendor_sites")
    .update({ last_checked_at: new Date().toISOString(), last_check_result: summary.slice(0, 500) })
    .eq("id", siteId);
  revalidatePath(PATH);
  return { error: null, result };
}
