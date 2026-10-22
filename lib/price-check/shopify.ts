import "server-only";

/**
 * Price check, Brief 1. Read-only access to Zeroinfy's own Shopify store.
 *
 * Two env vars, server-side only, never sent to the browser:
 *   SHOPIFY_STORE_DOMAIN  zeroinfy.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN   a custom-app Admin API token with read_products and
 *                         read_reports (the second is for ShopifyQL sales).
 *
 * Nothing in this brief writes to Shopify.
 */

const API_VERSION = "2026-07";

export type ShopifyVendor = { name: string; netSales6m: number | null };

export function shopifyConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_TOKEN);
}

async function adminQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) throw new Error("Shopify is not connected (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN unset).");

  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": token },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Shopify answered HTTP ${res.status}.`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new Error("Shopify returned no data.");
  return body.data;
}

/** Every vendor name on the store, paged (max page size 1000). */
async function allVendorNames(): Promise<string[]> {
  const names: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data: {
      productVendors: { nodes: string[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await adminQuery(
      `query Vendors($after: String) {
        productVendors(first: 1000, after: $after) { nodes pageInfo { hasNextPage endCursor } }
      }`,
      { after },
    );
    names.push(...data.productVendors.nodes);
    if (!data.productVendors.pageInfo.hasNextPage) return names;
    after = data.productVendors.pageInfo.endCursor;
  }
  throw new Error("More than 20,000 vendor names — stopped paging rather than loop forever.");
}

/** Net sales by vendor for the last 6 months, via ShopifyQL (needs read_reports). */
async function salesByVendor(): Promise<Map<string, number>> {
  const data: {
    shopifyqlQuery: { parseErrors: string[]; tableData: { rows: Record<string, string>[] } | null };
  } = await adminQuery(
    `{ shopifyqlQuery(query: "FROM sales SHOW net_sales GROUP BY product_vendor SINCE -6m UNTIL today ORDER BY net_sales DESC LIMIT 1000") {
        parseErrors tableData { rows }
      } }`,
  );
  if (data.shopifyqlQuery.parseErrors.length) throw new Error(data.shopifyqlQuery.parseErrors.join("; "));
  const out = new Map<string, number>();
  for (const r of data.shopifyqlQuery.tableData?.rows ?? []) {
    const v = Number(r.net_sales);
    if (r.product_vendor && Number.isFinite(v)) out.set(r.product_vendor, v);
  }
  return out;
}

/**
 * Vendor names with 6-month sales, sorted by sales then name.
 *
 * Sales are best-effort: if the token lacks read_reports, names still come
 * back and `salesError` says why the numbers are missing.
 */
export async function listShopifyVendors(): Promise<{ vendors: ShopifyVendor[]; salesError: string | null }> {
  const names = await allVendorNames();
  let sales = new Map<string, number>();
  let salesError: string | null = null;
  try {
    sales = await salesByVendor();
  } catch (e) {
    salesError = e instanceof Error ? e.message : String(e);
  }
  const vendors = names.map((name) => ({ name, netSales6m: sales.get(name) ?? (salesError ? null : 0) }));
  vendors.sort((a, b) => (b.netSales6m ?? -1) - (a.netSales6m ?? -1) || a.name.localeCompare(b.name));
  return { vendors, salesError };
}
