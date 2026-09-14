/**
 * Faceted filter counts: the shape, and the rules for turning them into option
 * labels (§5.5, §5.12).
 *
 * Plain module, not server-only: the filter bar is a client component and
 * needs `countLabel` and `orderOptions` as values.
 */

export type FacetRow = {
  facet: string;
  value_id: string | null;
  numbers: number;
  items: number;
};

export type FacetCounts = { numbers: number; items: number };

export type FacetMap = {
  /** The `_total` guard row: the candidate set with every filter applied. */
  total: number | null;
  byFacet: Record<string, Record<string, FacetCounts>>;
};

/**
 * The option id meaning "nothing recorded for this field" (Brief 17). Kept
 * here as well as in enquiry-labels so this module stays importable from both
 * sides without pulling the label table in.
 */
export const NO_DETAIL_ID = "__none__";

export function buildFacetMap(rows: FacetRow[]): FacetMap {
  const byFacet: Record<string, Record<string, FacetCounts>> = {};
  let total: number | null = null;

  for (const row of rows) {
    if (row.facet === "_total") {
      total = row.numbers;
      continue;
    }
    if (row.value_id == null) continue;
    (byFacet[row.facet] ??= {})[row.value_id] = {
      numbers: row.numbers,
      items: row.items,
    };
  }

  return { total, byFacet };
}

/**
 * "Bhanwar Borana (12)" — the option, and how many leads are behind it.
 *
 * It used to read "12 numbers · 18 items" on the facets that hang off interest
 * lines. Two figures where one was wanted: the question at a filter is always
 * "how much work is this", and work is leads. The second number was also the
 * larger one, so a teacher with several lines per lead read as far more than
 * the list would show — which is how a count meant to help became a count to
 * be second-guessed (§36.3).
 *
 * The items figure is still counted and still in the facet map; nothing here
 * stops a screen showing it where it genuinely answers the question.
 */
export function countLabel(
  name: string,
  facet: string,
  counts: FacetCounts | undefined,
): string {
  return `${name} (${counts?.numbers ?? 0})`;
}

/**
 * Busiest option first; everything with nothing behind it sinks to the bottom,
 * where it is greyed rather than hidden — an option that disappears reads as a
 * bug, and the counsellor still has to be able to see it is empty.
 *
 * Ties keep the master list's own order, which is alphabetical for teachers and
 * courses and deliberate for terms and contents, so the list is stable between
 * renders rather than shuffling as counts move.
 */
export function orderOptions<T extends { id: string; name: string }>(
  options: T[],
  counts: Record<string, FacetCounts> | undefined,
): T[] {
  if (!counts) return options;
  return options
    .map((option, index) => ({ option, index, n: counts[option.id]?.numbers ?? 0 }))
    // "No detail" is pinned to the bottom however many leads are behind it:
    // it is a different kind of answer from the rest of the list, and a
    // counsellor scanning for a teacher should never have to read past it.
    .sort(
      (a, b) =>
        Number(a.option.id === NO_DETAIL_ID) - Number(b.option.id === NO_DETAIL_ID) ||
        b.n - a.n ||
        a.index - b.index,
    )
    .map((x) => x.option);
}

export function isEmptyOption(
  facet: string,
  id: string,
  map: FacetMap | undefined,
): boolean {
  if (!map) return false;
  return (map.byFacet[facet]?.[id]?.numbers ?? 0) === 0;
}
