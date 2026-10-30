/**
 * Price check: updating the attempt / batch-recording text in a Zeroinfy
 * product description without touching its format.
 *
 * The description HTML is cut into tags and text pieces. Only text pieces are
 * ever changed, one piece for another, so every tag, table, style, link and
 * video stays exactly as it was. Pure (no server code).
 */

export type Segment = { i: number; text: string; flagged: boolean };

const MON = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
/** Text that usually states an attempt or a recording: "May 27", "Nov-26", "June 2026", "Batch 2", "Recording", "attempt". */
const FLAG = new RegExp(`\\b(${MON})[a-z]*\\.?[\\s'’-]*(\\d{2}|20\\d\\d)\\b|attempt|record|batch|onward|\\blive\\b`, "i");

type Piece = { tag: boolean; s: string };

/** Split HTML into tags (incl. comments, script/style bodies kept as tags) and text. */
export function pieces(html: string): Piece[] {
  const out: Piece[] = [];
  const re = /<!--[\s\S]*?-->|<(script|style|iframe)\b[\s\S]*?<\/\1\s*>|<[^>]*>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) out.push({ tag: false, s: html.slice(last, m.index) });
    out.push({ tag: true, s: m[0] });
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ tag: false, s: html.slice(last) });
  return out;
}

/** The text pieces of a description, numbered by their place among all pieces. */
export function segments(html: string): Segment[] {
  return pieces(html)
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.tag && p.s.trim())
    .map(({ p, i }) => ({ i, text: p.s, flagged: FLAG.test(decode(p.s)) }));
}

export type Edit = { i: number; from: string; to: string };

/** Apply edits to text pieces; fails if a piece is not what the edit expects (the description changed). */
export function applyEdits(html: string, edits: Edit[]): { ok: true; html: string } | { ok: false; why: string } {
  const ps = pieces(html);
  for (const e of edits) {
    const p = ps[e.i];
    if (!p || p.tag || p.s !== e.from) return { ok: false, why: "The description changed on Shopify since it was read — check it again." };
    if (/[<>]/.test(e.to)) return { ok: false, why: "New text can't contain < or > (it would change the layout)." };
    p.s = e.to;
  }
  return { ok: true, html: ps.map((p) => p.s).join("") };
}

/** Decode the few entities descriptions use, for reading. */
export function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}

/** Encode text typed by a person back into HTML text (keeps & and quotes safe). */
export function encode(s: string): string {
  return s.replace(/&(?!(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, "&amp;");
}

/** Which tab (H5 heading) a piece sits under: Product Info, System, Demo, About the Faculty. */
export function sectionOf(html: string): Map<number, string> {
  const ps = pieces(html);
  const out = new Map<number, string>();
  let cur = "";
  let inH = false;
  let heading = "";
  ps.forEach((p, i) => {
    if (p.tag) {
      if (/^<h[1-6]\b/i.test(p.s)) {
        inH = true;
        heading = "";
      } else if (/^<\/h[1-6]/i.test(p.s) && inH) {
        inH = false;
        if (heading.trim()) cur = heading.trim();
      }
    } else {
      if (inH) heading += decode(p.s);
      out.set(i, cur);
    }
  });
  return out;
}
