"use server";

import { revalidatePath } from "next/cache";

import { isAdmin, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/paged";

/**
 * Price check, Brief 2a. Reviewing AI-proposed links (Settings → Links).
 *
 * Every action re-checks the role and relies on admin-only RLS as well.
 * Approve/reject only ever touches rows a person has not already decided,
 * except the explicit "undo", so a bulk action can never overwrite a human
 * decision.
 */

export type LinkResult = { error: string | null; count?: number };

const PATH = "/settings/links";
const DENIED = "Only a manager or super admin can review links.";

async function gate(): Promise<{ userId: string | null; denied: string | null }> {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) return { userId: null, denied: DENIED };
  return { userId: viewer.userId, denied: null };
}

export async function setProductStatus(
  shopifyProductId: number,
  status: "approved" | "rejected",
  note?: string,
): Promise<LinkResult> {
  const { userId, denied } = await gate();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_variant_links")
    .update({
      status,
      review_note: note?.trim() || null,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("shopify_product_id", shopifyProductId)
    .eq("status", "suggested")
    .select("id");
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { error: null, count: data?.length ?? 0 };
}

export async function setVariantStatus(
  linkId: string,
  status: "approved" | "rejected" | "suggested",
  note?: string,
): Promise<LinkResult> {
  const { userId, denied } = await gate();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_variant_links")
    .update({
      status,
      review_note: status === "suggested" ? null : note?.trim() || null,
      reviewed_by: status === "suggested" ? null : userId,
      reviewed_at: status === "suggested" ? null : new Date().toISOString(),
    })
    .eq("id", linkId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Nothing was updated — the link was not found or you lack access." };
  revalidatePath(PATH);
  return { error: null, count: 1 };
}

/** Undo a product's review: everything back to "suggested". */
export async function resetProduct(shopifyProductId: number): Promise<LinkResult> {
  const { denied } = await gate();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_variant_links")
    .update({ status: "suggested", review_note: null, reviewed_by: null, reviewed_at: null })
    .eq("shopify_product_id", shopifyProductId)
    .in("status", ["approved", "rejected"])
    .select("id");
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { error: null, count: data?.length ?? 0 };
}

/**
 * Approve every still-suggested HIGH-confidence link of the products given.
 *
 * Takes the product ids the screen is showing rather than "all in the table",
 * so the button only ever approves what the person could see.
 */
export async function approveHighConfidence(shopifyProductIds: number[]): Promise<LinkResult> {
  const { userId, denied } = await gate();
  if (denied) return { error: denied };
  const ids = [...new Set(shopifyProductIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return { error: null, count: 0 };

  const supabase = await createClient();
  let count = 0;
  // .in() has a practical ceiling well below 1,000 values (docs/known-issues.md).
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("vendor_variant_links")
      .update({ status: "approved", reviewed_by: userId, reviewed_at: new Date().toISOString() })
      .in("shopify_product_id", ids.slice(i, i + 200))
      .eq("status", "suggested")
      .eq("confidence", "high")
      .select("id");
    if (error) return { error: error.message, count };
    count += data?.length ?? 0;
  }
  revalidatePath(PATH);
  return { error: null, count };
}

/* ------------------------------------------------------------- import ---- */

type SuggestionIn = {
  pid: number;
  vid: number;
  pt: string;
  ph?: string | null;
  vendor?: string | null;
  vt?: string | null;
  site: string; // vendor site name, as in Settings → Vendors
  slug?: string | null;
  ptitle?: string | null;
  bvid?: string | null;
  blabel?: string | null;
  conf: "high" | "medium" | "low";
  reason?: string | null;
  status?: "suggested" | "no_match";
};

/**
 * Load AI suggestions (a JSON array). Super-admin-adjacent tool, admin-gated.
 *
 * Never overwrites a link a person has approved or rejected: those variant ids
 * are skipped and counted. Everything else is upserted on shopify_variant_id.
 */
export async function importSuggestions(json: string): Promise<LinkResult & { skipped?: number; invalid?: number }> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") return { error: "Only a super admin can load suggestions." };

  let items: SuggestionIn[];
  try {
    items = JSON.parse(json);
    if (!Array.isArray(items)) throw new Error("not an array");
  } catch {
    return { error: "That isn't a JSON array of suggestions." };
  }
  if (items.length > 20_000) return { error: "Too many rows in one import (max 20,000)." };

  const supabase = await createClient();
  const { data: sites, error: sErr } = await supabase.from("vendor_sites").select("id, name");
  if (sErr) return { error: sErr.message };
  const siteId = new Map((sites ?? []).map((s) => [s.name.toLowerCase(), s.id]));

  const decided = await fetchAllRows<{ shopify_variant_id: number }>((from, to) =>
    supabase
      .from("vendor_variant_links")
      .select("shopify_variant_id")
      .in("status", ["approved", "rejected"])
      .range(from, to),
  );
  if (decided.error) return { error: decided.error };
  const keep = new Set(decided.rows.map((r) => Number(r.shopify_variant_id)));

  let invalid = 0;
  let skipped = 0;
  const rows = [];
  const seen = new Set<number>();
  for (const it of items) {
    const sid = siteId.get(String(it.site ?? "").toLowerCase());
    const status = it.status === "no_match" ? "no_match" : "suggested";
    const ok =
      sid &&
      Number.isFinite(it.pid) &&
      Number.isFinite(it.vid) &&
      typeof it.pt === "string" &&
      ["high", "medium", "low"].includes(it.conf) &&
      (status === "no_match" || (typeof it.slug === "string" && it.slug.length > 0));
    if (!ok || seen.has(it.vid)) {
      invalid++;
      continue;
    }
    seen.add(it.vid);
    if (keep.has(it.vid)) {
      skipped++;
      continue;
    }
    rows.push({
      shopify_product_id: it.pid,
      shopify_variant_id: it.vid,
      shopify_product_title: it.pt.slice(0, 500),
      shopify_product_handle: it.ph ?? null,
      shopify_vendor: it.vendor ?? null,
      shopify_variant_title: it.vt ?? null,
      vendor_site_id: sid,
      vendor_product_slug: status === "no_match" ? null : it.slug,
      vendor_product_title: it.ptitle ?? null,
      vendor_variant_id: it.bvid ?? null,
      vendor_variant_label: it.blabel ?? null,
      status,
      confidence: it.conf,
      reason: it.reason?.slice(0, 1000) ?? null,
      suggested_by: "ai",
      suggested_at: new Date().toISOString(),
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
    });
  }

  let count = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("vendor_variant_links")
      .upsert(rows.slice(i, i + 200), { onConflict: "shopify_variant_id" });
    if (error) return { error: `Stopped after ${count} rows: ${error.message}`, count, skipped, invalid };
    count += Math.min(200, rows.length - i);
  }
  revalidatePath(PATH);
  return { error: null, count, skipped, invalid };
}
