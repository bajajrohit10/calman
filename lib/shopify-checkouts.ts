/**
 * §55.2. Turning a Shopify abandoned-checkout export into import candidates.
 *
 * Pure and client-safe: this runs in the browser, before anything is sent to
 * the server, because the file never leaves the tab and the grouping has to
 * happen before the review table can be built.
 *
 * The shape of the problem is that a Shopify export is not a list of people.
 * It is a list of line items, which group into checkouts, which group into
 * people — and only the third of those is what Calman calls a lead.
 */

/** The columns this reads. Everything else in the 71-column export is ignored. */
export const SHOPIFY_COLUMNS = [
  "Id",
  "Name",
  "Created at",
  "Billing Name",
  "Email",
  "Billing Phone",
  "Shipping Phone",
  "Phone",
  "Lineitem name",
  "Vendor",
] as const;

/**
 * Whether a header row is this export.
 *
 * Deliberately narrow: three columns no other file in this building has
 * together. A false positive here would route somebody's own spreadsheet
 * through the Shopify rules and silently discard its rows.
 */
export function looksLikeShopify(headers: string[]): boolean {
  const set = new Set(headers.map((h) => h.trim().toLowerCase()));
  return (
    set.has("lineitem name") && set.has("billing phone") && set.has("created at")
  );
}

/* ------------------------------------------------------------------ phone -- */

const digitsOnly = (s: string) => (s ?? "").replace(/\D/g, "");

/**
 * §55.2(a). One phone cell to a ten-digit Indian mobile, or nothing.
 *
 * Four repairs, in the order they are worth trying:
 *
 *   * 12 digits starting 91 — the country code typed into the field.
 *   * 11 starting 0 — the old STD habit.
 *   * 11 starting 1 — a +1 picked from the country dropdown by mistake. The
 *     sample has one of these: "+19319223123" is a Delhi number with a US
 *     code in front of it, and dropping the 1 is the only reading that
 *     produces a real mobile.
 *
 * Anything that is not then ten digits opening 6–9 is not an Indian mobile and
 * is refused rather than guessed at.
 */
export function normaliseShopifyPhone(raw: string): string | null {
  let d = digitsOnly(raw);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  else if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export type PhonePick = {
  mobile: string | null;
  /** Which column it came from, for the report. */
  from: "Phone" | "Billing Phone" | "Shipping Phone" | null;
  /**
   * §55.2(a). Billing and Shipping both valid and different: Billing is used
   * and this is appended to the row's remarks so the other number is not lost.
   */
  altNote: string | null;
};

/**
 * The first candidate that survives normalisation, in the order the brief
 * gives: Phone, then Billing, then Shipping.
 */
export function pickPhone(row: Record<string, string>): PhonePick {
  const order: PhonePick["from"][] = ["Phone", "Billing Phone", "Shipping Phone"];
  let picked: string | null = null;
  let from: PhonePick["from"] = null;
  for (const col of order) {
    const n = normaliseShopifyPhone(row[col!] ?? "");
    if (n) {
      picked = n;
      from = col;
      break;
    }
  }

  const billing = normaliseShopifyPhone(row["Billing Phone"] ?? "");
  const shipping = normaliseShopifyPhone(row["Shipping Phone"] ?? "");
  let altNote: string | null = null;
  let mobile = picked;
  if (billing && shipping && billing !== shipping) {
    // Billing wins by instruction, and the other one is written down rather
    // than dropped — a second number on a lead is worth something.
    mobile = billing;
    from = "Billing Phone";
    altNote = `alt number ${shipping}`;
  }

  return { mobile, from, altNote };
}

/* --------------------------------------------------------------- grouping -- */

export type ShopifyRow = { rowNumber: number; raw: Record<string, string> };

/** One checkout: the Id (or Name) and the line items under it. */
export type Checkout = {
  ref: string;
  createdAt: string;
  name: string;
  email: string;
  productText: string;
  vendors: string[];
  phone: PhonePick;
  rowNumbers: number[];
};

/**
 * §55.2. The checkout key.
 *
 * Shopify's Id where there is one. Where there is not — and the first day's
 * file has exactly one such row — the Name column carries the same reference
 * with a "#" in front of it, so that is used with the hash stripped. A
 * checkout with neither is not dedupable and is given a key of its own so it
 * at least imports once.
 */
export function checkoutRef(raw: Record<string, string>, rowNumber: number): string {
  const id = (raw["Id"] ?? "").trim();
  if (id) return id;
  const name = (raw["Name"] ?? "").trim().replace(/^#/, "");
  if (name) return name;
  return `row-${rowNumber}`;
}

/** §55.2(b), first half: line items with the same Id are one checkout. */
export function groupCheckouts(rows: ShopifyRow[]): Checkout[] {
  const byRef = new Map<string, Checkout>();
  for (const r of rows) {
    const ref = checkoutRef(r.raw, r.rowNumber);
    const title = (r.raw["Lineitem name"] ?? "").trim();
    const vendor = (r.raw["Vendor"] ?? "").trim();
    const existing = byRef.get(ref);
    if (existing) {
      if (title) existing.productText = joinTitles(existing.productText, title);
      if (vendor && !existing.vendors.includes(vendor)) existing.vendors.push(vendor);
      existing.rowNumbers.push(r.rowNumber);
      continue;
    }
    byRef.set(ref, {
      ref,
      createdAt: (r.raw["Created at"] ?? "").trim(),
      name: (r.raw["Billing Name"] ?? "").trim(),
      email: (r.raw["Email"] ?? "").trim(),
      productText: title,
      vendors: vendor ? [vendor] : [],
      phone: pickPhone(r.raw),
      rowNumbers: [r.rowNumber],
    });
  }
  return [...byRef.values()];
}

/** " | ", which the parser now splits on (§55.1). Never doubled, never empty. */
function joinTitles(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  if (left.split(" | ").includes(right)) return left;
  return `${left} | ${right}`;
}

export type Candidate = {
  mobile: string;
  name: string;
  email: string;
  productText: string;
  vendorHint: string | null;
  /** Earliest Created at across the merged checkouts. */
  arrivedAtRaw: string;
  refs: string[];
  remarks: string[];
  rowNumbers: number[];
};

export type HeldCheckout = {
  ref: string;
  name: string;
  email: string;
  productText: string;
  arrivedAtRaw: string;
  vendor: string | null;
  rawPhones: string[];
};

export type ShopifyPlan = {
  candidates: Candidate[];
  held: HeldCheckout[];
  /** Checkout refs already imported in an earlier batch. */
  skipped: { ref: string; name: string }[];
  checkoutCount: number;
};

/**
 * §55.2(b), second half: checkouts sharing a mobile are one lead.
 *
 * The same person abandoning two carts an hour apart is one person who wants
 * two things, not two leads — and on the sample that is nine of the thirty-odd
 * numbers. Their titles are joined so both reach the parser, and the arrival
 * is the earliest of them because that is when they first showed interest.
 */
export function planShopifyImport(
  rows: ShopifyRow[],
  alreadySeen: Set<string>,
): ShopifyPlan {
  const checkouts = groupCheckouts(rows);
  const fresh = checkouts.filter((c) => !alreadySeen.has(c.ref));
  const skipped = checkouts
    .filter((c) => alreadySeen.has(c.ref))
    .map((c) => ({ ref: c.ref, name: c.name }));

  const held: HeldCheckout[] = [];
  const byMobile = new Map<string, Candidate>();

  for (const c of fresh) {
    if (!c.phone.mobile) {
      held.push({
        ref: c.ref,
        name: c.name,
        email: c.email,
        productText: c.productText,
        arrivedAtRaw: c.createdAt,
        vendor: c.vendors[0] ?? null,
        rawPhones: ["Phone", "Billing Phone", "Shipping Phone"]
          .map((k) => (rows.find((r) => r.rowNumber === c.rowNumbers[0])?.raw[k] ?? "").trim())
          .filter(Boolean),
      });
      continue;
    }

    const existing = byMobile.get(c.phone.mobile);
    if (!existing) {
      byMobile.set(c.phone.mobile, {
        mobile: c.phone.mobile,
        name: c.name,
        email: c.email,
        productText: c.productText,
        vendorHint: c.vendors.length === 1 ? c.vendors[0] : null,
        arrivedAtRaw: c.createdAt,
        refs: [c.ref],
        remarks: c.phone.altNote ? [c.phone.altNote] : [],
        rowNumbers: [...c.rowNumbers],
      });
      continue;
    }

    existing.productText = joinTitles(existing.productText, c.productText);
    existing.refs.push(c.ref);
    existing.rowNumbers.push(...c.rowNumbers);
    // The earliest arrival wins: it is when this person first showed interest,
    // and a later cart does not make that less true.
    if (c.createdAt && (!existing.arrivedAtRaw || c.createdAt < existing.arrivedAtRaw)) {
      existing.arrivedAtRaw = c.createdAt;
    }
    if (!existing.name && c.name) existing.name = c.name;
    if (!existing.email && c.email) existing.email = c.email;
    if (c.phone.altNote && !existing.remarks.includes(c.phone.altNote)) {
      existing.remarks.push(c.phone.altNote);
    }
    // A hint only survives while every checkout agrees about it. Two different
    // vendors for one person is two different teachers, and the titles say
    // which is which better than either vendor could.
    if (existing.vendorHint && !c.vendors.includes(existing.vendorHint)) {
      existing.vendorHint = null;
    }
  }

  return {
    candidates: [...byMobile.values()],
    held,
    skipped,
    checkoutCount: checkouts.length,
  };
}
