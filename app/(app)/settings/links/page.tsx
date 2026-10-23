import { PageHeader } from "@/components/ui";
import { requireAdminProfile } from "@/lib/auth";
import { fetchAllRows } from "@/lib/paged";
import { computeGaps } from "@/lib/price-check/gaps";
import { createClient } from "@/lib/supabase/server";

import { LinksView, type LinkRow } from "./links-view";

export const metadata = { title: "Links · Calman" };

const STATUSES = ["suggested", "approved", "rejected", "no_match"] as const;
type Status = (typeof STATUSES)[number];

/**
 * Price check, Brief 2a. Review AI-proposed links from each Zeroinfy variant
 * to the vendor product and batch it resells. Admin-only (Settings layout).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; conf?: string; q?: string }>;
}) {
  const { profile } = await requireAdminProfile();
  const sp = await searchParams;
  const missingView = sp.status === "missing";
  const status: Status = (STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as Status)
    : "suggested";
  const conf = ["high", "medium", "low"].includes(sp.conf ?? "") ? sp.conf! : null;
  const q = (sp.q ?? "").trim();

  const supabase = await createClient();

  const counts = await Promise.all(
    STATUSES.map(async (s) => {
      const { count } = await supabase
        .from("vendor_variant_links")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      return [s, count ?? 0] as const;
    }),
  );

  const gaps = await computeGaps(supabase);

  const result = missingView
    ? { rows: [] as LinkRow[], error: null, truncated: false }
    : await fetchAllRows<LinkRow>((from, to) => {
    let query = supabase
      .from("vendor_variant_links")
      .select(
        "id, shopify_product_id, shopify_variant_id, shopify_product_title, shopify_product_handle, shopify_vendor, shopify_variant_title, vendor_product_slug, vendor_product_title, vendor_variant_label, status, confidence, reason, review_note, vendor_sites(name, website_url)",
      )
      .eq("status", status)
      .order("shopify_product_title")
      .order("shopify_variant_title")
      .range(from, to);
    if (conf) query = query.eq("confidence", conf);
    if (q) query = query.ilike("shopify_product_title", `%${q}%`);
    return query as unknown as PromiseLike<{ data: LinkRow[] | null; error: { message: string } | null }>;
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Links"
        description="Which vendor product and batch each Zeroinfy variant resells. AI suggests; a person approves. Only approved links are used for price checks."
      />
      <LinksView
        rows={result.rows}
        counts={Object.fromEntries(counts) as Record<Status, number>}
        status={missingView ? "missing" : status}
        gaps={gaps}
        conf={conf}
        q={q}
        canImport={profile.role === "super_admin"}
        error={result.error}
        truncated={result.truncated}
      />
    </div>
  );
}
