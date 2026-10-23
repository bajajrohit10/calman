import "server-only";

/**
 * Price check. Reading every variant of a product on an edportal-hosted site
 * (bbvirtuals.com, akgclasses.com, shubhamsinghal.com, bbpublication.com).
 *
 * The public store-list feed only carries each product's DEFAULT variant. The
 * product page, though, is a Next.js page whose streamed payload
 * (self.__next_f.push([1, "…"]) chunks) contains the full "variants" array with
 * option labels, selling price and MRP per variant. This reads that.
 *
 * Fetched server-side because the browser blocks cross-site page reads.
 */

export type EdportalVariant = {
  id: string;
  title: string;
  options: string[]; // "FR: Batch 2 - Jan 26 Recordings"
  price: number | null;
  mrp: number | null;
  status: string | null;
};

export type EdportalProduct =
  | { ok: true; slug: string; variants: EdportalVariant[] }
  | { ok: false; slug: string; reason: string };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** Concatenate the streamed RSC string chunks into one decoded text. */
function rscPayload(html: string): string {
  let out = "";
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out += JSON.parse(m[1]) as string;
    } catch {
      // A chunk that isn't a plain JSON string is skipped, not fatal.
    }
  }
  return out;
}

/** The bracketed JSON value starting at `start`, string-aware. */
function sliceBalanced(text: string, start: number): string | null {
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
    else if (c === "[" || c === "{") depth++;
    else if ((c === "]" || c === "}") && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

type RawVariant = {
  id?: string;
  title?: string;
  status?: string;
  selling_price?: number;
  mrp_price?: number;
  option_values?: { option_label?: string; option_value_label?: string }[];
};

export async function readEdportalProduct(origin: string, slug: string): Promise<EdportalProduct> {
  let res: Response;
  try {
    res = await fetch(`${origin}/product/${encodeURIComponent(slug)}`, {
      headers: { "user-agent": UA, accept: "text/html" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, slug, reason: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { ok: false, slug, reason: `HTTP ${res.status}` };

  const payload = rscPayload(await res.text());
  const k = payload.indexOf('"variants":[');
  if (k < 0) return { ok: false, slug, reason: "No variant data on the page (product removed or page changed)." };
  const arr = sliceBalanced(payload, k + '"variants":'.length);
  let raw: RawVariant[];
  try {
    raw = arr ? (JSON.parse(arr) as RawVariant[]) : [];
  } catch {
    return { ok: false, slug, reason: "Variant data could not be parsed." };
  }

  const variants = raw
    .filter((v) => v && v.status !== "archived")
    .map((v) => ({
      id: String(v.id ?? ""),
      title: (v.title ?? "").trim(),
      options: (v.option_values ?? []).map(
        (o) => `${(o.option_label ?? "").trim()}: ${(o.option_value_label ?? "").trim()}`,
      ),
      price: typeof v.selling_price === "number" ? v.selling_price : null,
      mrp: typeof v.mrp_price === "number" ? v.mrp_price : null,
      status: v.status ?? null,
    }));
  return { ok: true, slug, variants };
}
