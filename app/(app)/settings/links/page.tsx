import { PageHeader } from "@/components/ui";
import { requireAdminProfile } from "@/lib/auth";
import { fetchAllRows } from "@/lib/paged";
import { computeTodo } from "@/lib/price-check/todo";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { VENDOR_GROUPS, groupOf, vendorGroup } from "@/lib/price-check/vendor-groups";

import { LinksView, type LinkRow } from "./links-view";
import { TodoView } from "./todo-view";

export const metadata = { title: "Links · Calman" };
// AI description updates can take up to a minute.
export const maxDuration = 120;

const STATUSES = ["suggested", "approved", "rejected", "no_match"] as const;
type Status = (typeof STATUSES)[number];

/**
 * Price check, Brief 2a. Review AI-proposed links from each Zeroinfy variant
 * to the vendor product and batch it resells. Admin-only (Settings layout).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; conf?: string; q?: string; view?: string; vendor?: string }>;
}) {
  const { profile } = await requireAdminProfile();
  const sp = await searchParams;
  const todoView = sp.view !== "links";
  const status: Status = (STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as Status)
    : "suggested";
  const conf = ["high", "medium", "low"].includes(sp.conf ?? "") ? sp.conf! : null;
  const q = (sp.q ?? "").trim();

  const supabase = await createClient();

  // One tab per vendor: BB Virtuals (with BB Publication) and Vsmart.
  const vg = vendorGroup(sp.vendor);
  const { data: allSites } = await supabase.from("vendor_sites").select("id, name");
  const siteIds = (allSites ?? []).filter((s) => groupOf(s.name)?.key === vg.key).map((s) => s.id);
  const ids = siteIds.length ? siteIds : ["00000000-0000-0000-0000-000000000000"];

  if (todoView) {
    const todo = await computeTodo(supabase, ids);
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title="To do on Zeroinfy"
          description={`What to change on the Zeroinfy listings so they match ${vg.label}: prices, missing batches and attempts, options for exams that have passed.`}
        />
        <ViewTabs todo vendor={vg.key} />
        <TodoView key={vg.key} todo={todo} canWrite={profile.role === "super_admin"} vendor={vg.short} vendorSite={vg.site} />
      </div>
    );
  }

  const counts = await Promise.all(
    STATUSES.map(async (s) => {
      const { count } = await supabase
        .from("vendor_variant_links")
        .select("id", { count: "exact", head: true })
        .eq("status", s)
        .in("vendor_site_id", ids);
      return [s, count ?? 0] as const;
    }),
  );

  const result = await fetchAllRows<LinkRow>((from, to) => {
    let query = supabase
      .from("vendor_variant_links")
      .select(
        "id, shopify_product_id, shopify_variant_id, shopify_product_title, shopify_product_handle, shopify_vendor, shopify_variant_title, vendor_product_slug, vendor_product_title, vendor_variant_label, status, confidence, reason, review_note, vendor_sites(name, website_url)",
      )
      .eq("status", status)
      .in("vendor_site_id", ids)
      .order("shopify_product_title")
      .order("shopify_variant_title")
      .range(from, to);
    if (conf) query = query.eq("confidence", conf);
    if (q) query = query.ilike("shopify_product_title", `%${q}%`);
    return query as unknown as PromiseLike<{ data: LinkRow[] | null; error: { message: string } | null }>;
  });

  return (
    <div className="flex flex-col gap-5">
      <ViewTabs todo={false} vendor={vg.key} />
      <PageHeader
        title="Links"
        description="Which vendor product and batch each Zeroinfy variant resells. AI suggests; a person approves. Only approved links are used for price checks."
      />
      <LinksView
        rows={result.rows}
        counts={Object.fromEntries(counts) as Record<Status, number>}
        status={status}
        conf={conf}
        q={q}
        canImport={profile.role === "super_admin"}
        error={result.error}
        truncated={result.truncated}
      />
    </div>
  );
}

function ViewTabs({ todo, vendor }: { todo: boolean; vendor: string }) {
  const cls = (on: boolean) =>
    `rounded-md px-3 py-1 text-[12.5px] ${on ? "bg-accent text-white" : "border border-line-2 text-ink-2 hover:bg-surface-2"}`;
  const href = (v: string, t: boolean) => `/settings/links?vendor=${v}${t ? "" : "&view=links"}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-lg border border-line p-1">
        {VENDOR_GROUPS.map((g) => (
          <Link key={g.key} href={href(g.key, todo)} className={cls(vendor === g.key)}>
            {g.label}
          </Link>
        ))}
      </div>
      <span className="text-ink-3">·</span>
      <Link href={href(vendor, true)} className={cls(todo)}>
        To do on Zeroinfy
      </Link>
      <Link href={href(vendor, false)} className={cls(!todo)}>
        All links (admin)
      </Link>
    </div>
  );
}
