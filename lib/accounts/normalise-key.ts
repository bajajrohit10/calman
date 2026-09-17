/**
 * §50B.1. Product title -> combo key.
 *
 * This is one half of a pair. The other is accounts.normalise_key(text) in
 * migration 130, and the two have to agree exactly: the importer keys every
 * sales line with the SQL one, the Combos tab pre-fills the key with this one,
 * and a disagreement means combos entered in the UI quietly stop matching the
 * lines they were created for. There is no runtime check that they match —
 * there cannot be, the importer runs in the database — so they are kept
 * honest by the test at supabase/tests/resolve_rate_test.sql and by
 * lib/accounts/normalise-key.test.ts, which run the same sample list through
 * both and compare.
 *
 * The rules, in order:
 *   1. Cut at a standalone "by". A title stops naming the product and starts
 *      naming who teaches it at that word, and the same combo sold under two
 *      teachers is still the same combo.
 *   2. Lowercase.
 *   3. Every run of non-alphanumeric characters becomes one hyphen, so dash
 *      variants, brackets, slashes, ampersands and double spaces all land in
 *      the same place.
 *   4. Trim hyphens off both ends.
 *
 * Returns null for a title that normalises to nothing, which is what the SQL
 * side does too — an empty string would be a key that matches every other
 * empty key, and that is worse than no key.
 */
export function normaliseKey(input: string | null | undefined): string | null {
  const head = (input ?? "").replace(/\s+by\s+.*$/i, "");
  const key = head
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return key === "" ? null : key;
}

/**
 * The sample list both implementations are checked against. Kept here rather
 * than in the test file so the SQL test can be regenerated from the same
 * source if it ever needs to be.
 */
export const NORMALISE_KEY_SAMPLES = [
  "CA Final AFM (Combo) by CA Aaditya Jain",
  "  CA Inter -- Law / Set A  ",
  "CA Final DT and IDT Combo By CA Bhanwar Borana",
  "CMA Inter — Group I & II Combo",
  "CA Foundation Combo (Maths + Stats)",
  "   ---  ",
  "",
] as const;
