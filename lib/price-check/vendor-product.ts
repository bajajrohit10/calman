import "server-only";

import { createHash } from "node:crypto";

import { readEdportalProduct, type EdportalProduct } from "@/lib/price-check/edportal";
import { readProductPrice, type PriceBasis, type ReadMethod } from "@/lib/price-check/readers";

/**
 * Price check: every option of one vendor product, whatever site it is on, in
 * the shape the Links screens use (EdportalVariant). Today: course-platform
 * sites (BB-style) and Vsmart. Other read methods report that they can't list
 * options yet.
 */

export type OptionSite = {
  website_url: string;
  read_method: string;
  platform_key?: string | null;
  price_basis?: string | null;
};

/** Sites whose options Calman can list in Batches & options. */
export function canListOptions(site: { read_method: string }): boolean {
  return site.read_method === "edportal_feed" || site.read_method === "vsmart_page";
}

/** Vsmart variants have no id of their own: a short stable key from the option text. */
const vsmartId = (label: string) => `vs_${createHash("sha1").update(label).digest("hex").slice(0, 16)}`;

/**
 * "Direct Taxation & Indirect Taxation:Mode:Recorded,Validity:9 Months, Books:Hard Copy"
 * → ["Direct Taxation & Indirect Taxation: Mode: Recorded", "Validity: 9 Months", "Books: Hard Copy"].
 */
function vsmartOptions(label: string): string[] {
  return label
    .split(/,\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/:(?=\S)/g, ": "));
}

export async function readVendorProduct(site: OptionSite, slug: string): Promise<EdportalProduct> {
  const origin = new URL(site.website_url).origin;
  if (site.read_method === "edportal_feed") return readEdportalProduct(origin, slug);
  if (site.read_method === "vsmart_page") {
    const r = await readProductPrice(
      {
        website_url: site.website_url,
        read_method: "vsmart_page" as ReadMethod,
        platform_key: site.platform_key ?? null,
        price_basis: (site.price_basis ?? "after_auto_coupon") as PriceBasis,
      },
      `${origin}/courses2/product/${encodeURIComponent(slug)}`,
    );
    if (!r.ok) return { ok: false, slug, reason: r.reason };
    return {
      ok: true,
      slug,
      title: r.title,
      variants: r.variants.map((v) => ({
        id: vsmartId(v.label),
        title: v.label,
        options: vsmartOptions(v.label),
        price: v.price,
        mrp: v.mrp,
        status: "active",
      })),
    };
  }
  return { ok: false, slug, reason: "Options can only be read for course-platform sites and Vsmart so far." };
}

/** The product slug in a pasted vendor link, for the sites Calman can list. */
export function slugFromLink(site: { read_method: string }, u: URL): string | null {
  const parts = u.pathname.split("/").filter(Boolean);
  const after = (marker: string) => {
    const i = parts.indexOf(marker);
    return i >= 0 && parts[i + 1] ? decodeURIComponent(parts[i + 1]) : null;
  };
  if (site.read_method === "vsmart_page") return after("product"); // /courses2/product/<slug>
  return after("product"); // /product/<slug>
}
