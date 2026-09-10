import "server-only";

/**
 * Read every row of a query, not the first thousand.
 *
 * PostgREST caps a response at `max_rows` (1000 on this project) and says
 * nothing about it: the request succeeds and the array is simply short. Any
 * query whose result feeds a count, an export, a report or a cleanup is
 * therefore wrong the moment the table outgrows a thousand rows, and wrong
 * silently — which is how a purge once reported removing 21,000 students while
 * deleting none.
 *
 * Use this wherever the *whole* set matters. Where only a page matters, pass an
 * explicit limit instead; where only a number matters, use
 * `{ count: "exact", head: true }`, which is exact regardless of max_rows.
 */
const PAGE = 500;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  options: { pageSize?: number; max?: number } = {},
): Promise<{ rows: T[]; error: string | null; truncated: boolean }> {
  const size = Math.min(options.pageSize ?? PAGE, PAGE);
  const max = options.max ?? 50_000;
  const rows: T[] = [];

  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return { rows, error: error.message, truncated: false };

    const batch = data ?? [];
    rows.push(...batch);

    // A short page is the end of the set. A full page might be, so we ask again.
    if (batch.length < size) return { rows, error: null, truncated: false };
  }

  // Hit the ceiling: better to say so than to return a plausible-looking
  // fraction of the answer.
  return { rows, error: null, truncated: true };
}
