/**
 * §87. One reader for every query string the app parses twice.
 *
 * Each list screen parses its filters from the URL, and something behind it
 * parses the same URL again server-side: the export, "select all N matching",
 * a bulk action. The parsers were already shared — `parseEnquiriesParams` and
 * friends — but the *reader* handed to them was not, and that is where the two
 * readings drifted apart.
 *
 * A multi-select submits its values as repeated keys (`source=a&source=b`), so
 * a reader built on `URLSearchParams.get` returns the first and silently drops
 * the rest. Every page read all of them and joined them with commas; every
 * server-side re-parse took the first. So the Enquiries list filtered to five
 * sources and its export filtered to one — the first — which is Brief 87's
 * bug, and the same reader sat behind the desk's select-all, the ticket queue's
 * export and the New Calls bulk actions.
 *
 * The fix is not another shared reader that a caller may or may not use: the
 * parsers take the params themselves now, so there is nothing left to pass and
 * no way to pass something lossy.
 */

/** What a parser accepts: Next's searchParams object, or a parsed query string. */
export type ParamSource =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

export type ParamReader = (key: string) => string | null;

/**
 * Every value of a key, comma-joined — the one shape the array filters expect.
 *
 * Comma-joined rather than an array because that is also how a hand-built or
 * pasted link carries a multi-select (`?source=a,b`), and how analytics builds
 * its click-throughs. Both shapes arrive here and leave identical, so a link
 * somebody typed and a form somebody submitted filter the same way.
 */
export function paramReader(src: ParamSource): ParamReader {
  if (src instanceof URLSearchParams) {
    return (key) => {
      const all = src.getAll(key).filter((v) => v !== "");
      return all.length ? all.join(",") : null;
    };
  }
  return (key) => {
    const v = src[key];
    if (Array.isArray(v)) {
      const all = v.filter((x) => x !== "");
      return all.length ? all.join(",") : null;
    }
    return v === undefined || v === "" ? null : v;
  };
}
