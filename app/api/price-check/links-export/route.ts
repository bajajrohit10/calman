import { getViewer } from "@/lib/auth";
import { fetchAllRows } from "@/lib/paged";
import { createClient } from "@/lib/supabase/server";

/**
 * Read-only export of the current links and stored BB options, for the
 * offline batch-name check (super admin). Writes nothing.
 */
export async function GET() {
  const viewer = await getViewer();
  if (viewer.profile?.role !== "super_admin") return Response.json({ error: "Super admin only." }, { status: 403 });
  const supabase = await createClient();
  const links = await fetchAllRows((from, to) =>
    supabase
      .from("vendor_variant_links")
      .select("shopify_product_id, shopify_variant_id, shopify_product_title, shopify_variant_title, vendor_product_slug, vendor_product_title, vendor_variant_id, vendor_variant_label, status, reviewed_by, review_note, keep_price, shopify_price")
      .range(from, to),
  );
  const options = await fetchAllRows((from, to) => supabase.from("vendor_options").select("product_slug, product_title, variant_id, label, price, state").range(from, to));
  const alts = await fetchAllRows((from, to) => supabase.from("link_alternatives").select("shopify_product_id, shopify_variant_id, product_slug").range(from, to));
  return Response.json({ links: links.rows, options: options.rows, alts: alts.rows, error: links.error ?? options.error ?? alts.error }, { headers: { "cache-control": "no-store" } });
}
