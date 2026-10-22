import "server-only";

/**
 * Price check, Brief 1. Reading one product's price from a vendor website.
 *
 * Four methods, one per platform found in the Brief 1 investigation:
 *
 *   edportal_feed     bbvirtuals.com, akgclasses.com, shubhamsinghal.com — one
 *                     public JSON list of every published product per project.
 *                     Gives the DEFAULT variant only.
 *   shopify_feed      fast.edu.in — the standard /products/<handle>.json.
 *   vsmart_page       vsmartacademy.com — the Remix loader JSON for the page,
 *                     all variants, prices in paise, plus auto-applied offers.
 *   letscommerce_page letscommerce.co.in — a coursePricing array embedded in
 *                     the HTML. A missing course still returns 200, so "no
 *                     table" is the failure signal, never the status code.
 *
 * Every reader returns either prices or a reason. A reader must never return a
 * number it is not sure of: a wrong "ok" is worse than an honest failure,
 * because a green tick stops anybody looking.
 *
 * Etiquette (Brief 1 ground rules): one request per read where possible, a
 * normal browser user agent, a timeout, and no attempt to get past bot
 * protection. A block is reported as a block.
 */

export type ReadMethod =
  | "edportal_feed"
  | "shopify_feed"
  | "vsmart_page"
  | "letscommerce_page"
  | "manual";

export type PriceBasis = "listed" | "after_auto_coupon";

export type SiteForRead = {
  website_url: string;
  read_method: ReadMethod;
  platform_key: string | null;
  price_basis: PriceBasis;
};

export type VariantPrice = {
  label: string;
  /** What the vendor charges, in rupees, on the site's price basis. */
  price: number;
  /** Struck-through price, when the site shows one. */
  mrp: number | null;
  /** How the number was arrived at, shown on the screen so it can be checked. */
  derivation?: string;
};

export type ReadResult =
  | { ok: true; title: string; variants: VariantPrice[]; notes: string[] }
  | { ok: false; reason: string };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TIMEOUT_MS = 15_000;

async function get(url: string, accept: string): Promise<Response> {
  return fetch(url, {
    headers: { "user-agent": UA, accept },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function fail(reason: string): ReadResult {
  return { ok: false, reason };
}

function describeHttp(res: Response): string {
  if (res.status === 403 || res.status === 429) {
    return `The site refused the request (HTTP ${res.status}) — likely bot protection. Mark the site blocked or manual.`;
  }
  return `The site answered HTTP ${res.status}.`;
}

/** The last path segment after a given marker, e.g. /product/<slug>. */
function slugAfter(url: URL, marker: string): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf(marker);
  if (i < 0 || !parts[i + 1]) return null;
  return decodeURIComponent(parts[i + 1]);
}

function sameSite(productUrl: URL, siteUrl: string): boolean {
  const strip = (h: string) => h.replace(/^www\./, "").toLowerCase();
  try {
    return strip(productUrl.hostname) === strip(new URL(siteUrl).hostname);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------- edportal -- */

type EdportalItem = {
  id: string;
  title: string;
  url_slug: string;
  variant_id: string | null;
  selling_price: number | null;
  mrp_price: number | null;
};

const EDPORTAL_PAGE = 500;

async function readEdportal(site: SiteForRead, url: URL): Promise<ReadResult> {
  if (!site.platform_key) return fail("This site has no platform key set (e.g. 'onr' for BB).");
  const slug = slugAfter(url, "product");
  if (!slug) return fail("Paste a product URL — it should contain /product/<name>.");

  const feed =
    `https://data.edportal.in/api/v1/products/${encodeURIComponent(site.platform_key)}` +
    `/storefront/product/store-list?status__in=published&product_type__in=public&count=${EDPORTAL_PAGE}`;
  const res = await get(feed, "application/json");
  if (!res.ok) return fail(describeHttp(res));

  const body = (await res.json().catch(() => null)) as { apiSuccess?: boolean; data?: EdportalItem[] } | null;
  if (!body?.apiSuccess || !Array.isArray(body.data)) {
    return fail("The product feed did not return the expected list.");
  }

  const notes: string[] = [];
  if (body.data.length >= EDPORTAL_PAGE) {
    // The feed may be capped at the page size; a product past the cap would
    // look like "not found". Say so rather than mislead.
    notes.push(`The feed returned ${body.data.length} products — it may be cut off at ${EDPORTAL_PAGE}.`);
  }

  const item = body.data.find((p) => p.url_slug === slug);
  if (!item) {
    return fail("This product is not in the site's published list (removed, unpublished, or the URL is wrong).");
  }
  if (typeof item.selling_price !== "number") {
    return fail("The product is listed but has no selling price in the feed.");
  }

  notes.push("Default variant only — if the page has a Mode or Batch choice, other options may cost differently.");
  return {
    ok: true,
    title: item.title,
    variants: [
      {
        label: "Default variant",
        price: item.selling_price,
        mrp: typeof item.mrp_price === "number" ? item.mrp_price : null,
        derivation: "selling_price from the store feed",
      },
    ],
    notes,
  };
}

/* --------------------------------------------------------------- shopify -- */

type ShopifyProductJson = {
  product?: {
    title: string;
    variants: { title: string; price: string; compare_at_price: string | null }[];
  };
};

async function readShopify(site: SiteForRead, url: URL): Promise<ReadResult> {
  const handle = slugAfter(url, "products");
  if (!handle) return fail("Paste a product URL — it should contain /products/<handle>.");

  const origin = new URL(site.website_url).origin;
  const res = await get(`${origin}/products/${encodeURIComponent(handle)}.json`, "application/json");
  if (res.status === 404) return fail("No such product on the vendor's store (404).");
  if (!res.ok) return fail(describeHttp(res));

  const body = (await res.json().catch(() => null)) as ShopifyProductJson | null;
  const p = body?.product;
  if (!p || !Array.isArray(p.variants) || p.variants.length === 0) {
    return fail("The product JSON had no variants.");
  }

  const variants: VariantPrice[] = [];
  for (const v of p.variants) {
    const price = Number(v.price);
    if (!Number.isFinite(price)) return fail(`Variant "${v.title}" has an unreadable price.`);
    const mrp = v.compare_at_price == null ? null : Number(v.compare_at_price);
    variants.push({
      label: v.title,
      price,
      mrp: mrp != null && Number.isFinite(mrp) ? mrp : null,
      derivation: "variant price from /products/<handle>.json",
    });
  }
  return { ok: true, title: p.title, variants, notes: [] };
}

/* ---------------------------------------------------------------- vsmart -- */

type VsmartLoader = {
  product?: {
    title: string;
    priceWithTax: number;
    variantProperties?: { name: string; priceWithTax: number; stockLevel?: string }[];
    offers?: { code?: string; discountType?: string; discountAmount?: number }[] | null;
  };
};

/**
 * What Vsmart shows as the total, in rupees, from the stored paise price.
 *
 * Seen on 22 Oct 2026: stored 800000 with a fixed Rs 1,000 auto coupon showed
 * "Total amount ₹6,999"; stored 5850000 with no offer showed ₹58,499. Both fit
 * price − ₹1 − coupon. Two data points, not a documented rule — the
 * derivation string carries the arithmetic so a wrong guess is visible.
 */
const VSMART_DISPLAY_OFFSET = 1;

async function readVsmart(site: SiteForRead, url: URL): Promise<ReadResult> {
  const slug = slugAfter(url, "product");
  if (!slug) return fail("Paste a product URL — it should contain /courses2/product/<name>.");

  const origin = new URL(site.website_url).origin;
  const route = encodeURIComponent("routes/courses2.product.$productSlug");
  const res = await get(`${origin}/courses2/product/${encodeURIComponent(slug)}?_data=${route}`, "application/json");
  if (res.status === 404) return fail("No such product on Vsmart (404).");
  if (!res.ok) return fail(describeHttp(res));

  const body = (await res.json().catch(() => null)) as VsmartLoader | null;
  const p = body?.product;
  if (!p || typeof p.priceWithTax !== "number") {
    return fail("The page data had no product price (the URL may be wrong or the product removed).");
  }

  const fixedOffers = (p.offers ?? []).filter(
    (o) => o.discountType === "fixed" && typeof o.discountAmount === "number",
  );
  const coupon = fixedOffers.reduce((m, o) => Math.max(m, o.discountAmount ?? 0), 0);
  const notes: string[] = [];
  if ((p.offers ?? []).length > fixedOffers.length) {
    notes.push("The product has a non-fixed offer this reader does not apply — check the page.");
  }

  const raw = p.variantProperties?.length
    ? p.variantProperties.map((v) => ({ label: v.name, paise: v.priceWithTax }))
    : [{ label: "Default", paise: p.priceWithTax }];

  const variants: VariantPrice[] = raw.map(({ label, paise }) => {
    const listed = paise / 100;
    if (site.price_basis === "after_auto_coupon") {
      const shown = listed - VSMART_DISPLAY_OFFSET - coupon;
      return {
        label,
        price: shown,
        mrp: listed,
        derivation: `₹${listed} − ₹${VSMART_DISPLAY_OFFSET}${coupon ? ` − ₹${coupon} auto coupon (${fixedOffers.map((o) => o.code).join(", ")})` : ""}`,
      };
    }
    return { label, price: listed, mrp: null, derivation: "stored price, no coupon applied" };
  });

  return { ok: true, title: p.title, variants, notes };
}

/* ----------------------------------------------------------- letscommerce -- */

type LcPricing = {
  mode?: string;
  variation?: string;
  views?: string;
  validity?: string;
  mrp?: number;
  salePrice?: number;
};

/** The JSON array that starts at `start` (an index of '['), string-aware. */
function sliceJsonArray(text: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

async function readLetsCommerce(site: SiteForRead, url: URL): Promise<ReadResult> {
  const slug = slugAfter(url, "course");
  if (!slug) return fail("Paste a course URL — it should contain /course/<name>.");

  const origin = new URL(site.website_url).origin;
  const res = await get(`${origin}/course/${encodeURIComponent(slug)}`, "text/html");
  if (!res.ok) return fail(describeHttp(res));
  const html = await res.text();

  // The page embeds the product object; make sure we read THIS course's table,
  // not a related course's that happens to come first.
  const own = html.indexOf(`"slug":"${slug}"`);
  if (own < 0) {
    return fail("No course data on that page — the site shows a normal page even for missing courses, so treat this as not found.");
  }
  const key = html.indexOf('"coursePricing":', own);
  const open = key < 0 ? -1 : html.indexOf("[", key);
  const arr = open < 0 ? null : sliceJsonArray(html, open);
  let rows: LcPricing[] | null = null;
  try {
    rows = arr ? (JSON.parse(arr) as LcPricing[]) : null;
  } catch {
    rows = null;
  }
  if (!rows || rows.length === 0) return fail("The course page had no readable price table.");

  // The nearest "title" before this course's slug is its own title.
  const titles = [...html.slice(Math.max(0, own - 400), own).matchAll(/"title":"([^"]+)"/g)];
  const titleMatch = titles.length ? titles[titles.length - 1] : null;
  const variants: VariantPrice[] = [];
  for (const r of rows) {
    if (typeof r.salePrice !== "number") continue;
    variants.push({
      label: [r.mode, r.variation, r.views, r.validity].filter(Boolean).join(" · ") || "Option",
      price: r.salePrice,
      mrp: typeof r.mrp === "number" ? r.mrp : null,
      derivation: "salePrice from the page's coursePricing table",
    });
  }
  if (variants.length === 0) return fail("The price table had no sale prices.");
  return { ok: true, title: titleMatch?.[1] ?? slug, variants, notes: [] };
}

/* ------------------------------------------------------------------ entry -- */

export async function readProductPrice(site: SiteForRead, productUrl: string): Promise<ReadResult> {
  let url: URL;
  try {
    url = new URL(productUrl.trim());
  } catch {
    return fail("That is not a valid URL.");
  }
  if (!sameSite(url, site.website_url)) {
    return fail(`That URL is not on ${new URL(site.website_url).hostname}.`);
  }

  try {
    switch (site.read_method) {
      case "edportal_feed":
        return await readEdportal(site, url);
      case "shopify_feed":
        return await readShopify(site, url);
      case "vsmart_page":
        return await readVsmart(site, url);
      case "letscommerce_page":
        return await readLetsCommerce(site, url);
      case "manual":
        return fail("This site is set to manual — its prices are entered by hand, not read.");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|aborted/i.test(msg)) return fail("The site did not answer within 15 seconds.");
    return fail(`Could not reach the site: ${msg}`);
  }
}
