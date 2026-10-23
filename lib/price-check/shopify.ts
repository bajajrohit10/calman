import "server-only";

/**
 * Price check, Brief 1. Read-only access to Zeroinfy's own Shopify store.
 *
 * Env vars, server-side only, never sent to the browser:
 *   SHOPIFY_STORE_DOMAIN   zeroinfy.myshopify.com
 * and EITHER (preferred — Shopify stopped allowing new admin-created custom
 * apps in 2026, so a new connection is a Dev Dashboard app):
 *   SHOPIFY_CLIENT_ID      } a Dev Dashboard app installed on the store with
 *   SHOPIFY_CLIENT_SECRET  } scopes read_products + read_reports. Calman swaps
 *                            them for a ~24h token (client credentials grant)
 *                            and caches it in memory.
 * OR, for an existing admin-created custom app:
 *   SHOPIFY_ADMIN_TOKEN    shpat_… with the same scopes.
 *
 * Writes (adding a batch option / variants to a listing) need write_products
 * and are only ever made from an explicit, confirmed super-admin action in
 * Settings → Links. Every write is logged in public.shopify_change_log.
 */

const API_VERSION = "2026-07";

export type ShopifyVendor = { name: string; netSales6m: number | null };

export function shopifyConfigured(): boolean {
  const e = process.env;
  return Boolean(
    e.SHOPIFY_STORE_DOMAIN && (e.SHOPIFY_ADMIN_TOKEN || (e.SHOPIFY_CLIENT_ID && e.SHOPIFY_CLIENT_SECRET)),
  );
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(domain: string): Promise<string> {
  const fixed = process.env.SHOPIFY_ADMIN_TOKEN;
  if (fixed) return fixed;

  // Refresh five minutes before Shopify's ~24h expiry.
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;

  const id = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Shopify is not connected (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET unset).");

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Shopify's OAuth error body names the reason (e.g. app not installed).
    // It never echoes the secret, so it is safe to show to an admin.
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(
      `Shopify refused the app credentials (HTTP ${res.status}${detail ? `: ${detail}` : ""}). ` +
        "Check the Client ID/secret and that the app is released and installed on the store.",
    );
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Shopify returned no access token.");
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export async function adminQuery<T>(query: string, variables?: Record<string, unknown>, retried = false): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("Shopify is not connected (SHOPIFY_STORE_DOMAIN unset).");
  const token = await accessToken(domain);

  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": token },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if ((res.status === 401 || res.status === 403) && !retried && cached) {
    // A cached token minted before a scope change keeps the old scopes: mint a fresh one once.
    cached = null;
    return adminQuery<T>(query, variables, true);
  }
  if (!res.ok) throw new Error(`Shopify answered HTTP ${res.status}.`);
  const body = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
  if (body.errors?.length) {
    const denied = body.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
    if (denied && !retried && cached) {
      cached = null;
      return adminQuery<T>(query, variables, true);
    }
    const msg = body.errors.map((e) => e.message).join("; ");
    throw new Error(
      denied
        ? `Shopify refused: ${msg} — the Calman app needs the write_products permission (Dev Dashboard → new version → release → approve in the store).`
        : msg,
    );
  }
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

/** Scopes Shopify has actually granted the app (fresh token, so a recent scope change shows). */
export async function grantedScopes(): Promise<string[]> {
  cached = null;
  const data: { currentAppInstallation: { accessScopes: { handle: string }[] } } = await adminQuery(
    `{ currentAppInstallation { accessScopes { handle } } }`,
  );
  return data.currentAppInstallation.accessScopes.map((s) => s.handle);
}
