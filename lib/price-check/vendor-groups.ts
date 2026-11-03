/**
 * Price check: the vendors the Links screens are split by. Each group is one
 * tab ("BB Virtuals", "Vsmart"); a site belongs to the first group whose
 * pattern matches its name in Settings → Vendors. Client-safe.
 */

export type VendorGroup = { key: string; label: string; short: string; site: string; rx: RegExp };

export const VENDOR_GROUPS: VendorGroup[] = [
  { key: "bb", label: "BB Virtuals", short: "BB", site: "bbvirtuals.com", rx: /^BB\b/i },
  { key: "vsmart", label: "Vsmart Academy", short: "Vsmart", site: "vsmartacademy.com", rx: /vsmart/i },
];

export function groupOf(siteName: string): VendorGroup | null {
  return VENDOR_GROUPS.find((g) => g.rx.test(siteName)) ?? null;
}

export function vendorGroup(key: string | undefined | null): VendorGroup {
  return VENDOR_GROUPS.find((g) => g.key === key) ?? VENDOR_GROUPS[0];
}

/** A vendor product's page: Vsmart keeps products under /courses2/product/. */
export function productUrl(siteUrl: string, slug: string | null | undefined): string {
  const s = encodeURIComponent(slug ?? "");
  return /vsmartacademy\.com/i.test(siteUrl) ? `${siteUrl.replace(/\/$/, "")}/courses2/product/${s}` : `${siteUrl.replace(/\/$/, "")}/product/${s}`;
}
