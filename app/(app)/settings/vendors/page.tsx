import { PageHeader } from "@/components/ui";
import { requireAdminProfile } from "@/lib/auth";
import { listShopifyVendors, shopifyConfigured, type ShopifyVendor } from "@/lib/price-check/shopify";
import { createClient } from "@/lib/supabase/server";

import { VendorsView, type AliasRow, type ExclusionRow, type SiteRow } from "./vendors-view";

export const metadata = { title: "Vendors · Calman" };

/**
 * Price check, Brief 1. Which website each Shopify vendor name is sold from,
 * and how that site's prices are read.
 *
 * Its own route under Settings, which is already admin-gated in the layout.
 * Nothing here is loaded by any counsellor screen: the only shared change is
 * the "Vendors" tab label inside Settings.
 */
export default async function Page() {
  await requireAdminProfile();
  const supabase = await createClient();

  const [sites, aliases, exclusions] = await Promise.all([
    supabase
      .from("vendor_sites")
      .select("id, name, website_url, read_method, platform_key, price_basis, status, notes, is_active, last_checked_at, last_check_result")
      .order("name"),
    supabase.from("vendor_site_aliases").select("id, vendor_site_id, shopify_vendor").order("shopify_vendor"),
    supabase.from("price_check_excluded_vendors").select("id, shopify_vendor, reason").order("shopify_vendor"),
  ]);

  let shopify: { vendors: ShopifyVendor[]; salesError: string | null } | null = null;
  let shopifyError: string | null = null;
  if (shopifyConfigured()) {
    try {
      shopify = await listShopifyVendors();
    } catch (e) {
      shopifyError = e instanceof Error ? e.message : String(e);
    }
  } else {
    shopifyError =
      "Shopify is not connected yet: set SHOPIFY_STORE_DOMAIN plus SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET from a Dev Dashboard app (scopes read_products, read_reports). Vendor names can still be typed by hand.";
  }

  const loadError = sites.error?.message ?? aliases.error?.message ?? exclusions.error?.message ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Vendors"
        description="Which website each Shopify vendor is sold from, and how its prices are read. Used by price check."
      />
      <VendorsView
        sites={(sites.data ?? []) as SiteRow[]}
        aliases={(aliases.data ?? []) as AliasRow[]}
        exclusions={(exclusions.data ?? []) as ExclusionRow[]}
        shopifyVendors={shopify?.vendors ?? null}
        shopifyNote={shopifyError ?? shopify?.salesError ?? null}
        error={loadError}
      />
    </div>
  );
}
