/**
 * §50E.1(2). Which arm of the Kolkata centre a sale belongs to.
 *
 * The sales sheet books 51 rows a month to "Zeroinfy Kolkata", but the centre
 * settles through two different houses and we hold them as two vendors. The
 * sheet gives no column that says which, so the teacher named in the course
 * title decides it.
 *
 * Edited here rather than in the importer because this is a list of people,
 * and lists of people change without the import logic changing. A name is
 * matched case-insensitively anywhere in the course title.
 */

export type CenterArm = { vendor: string; names: string[] };

export const ZEROINFY_KOLKATA_ARMS: CenterArm[] = [
  {
    vendor: "Zeroinfy Kolkata - BB",
    names: ["Kandoi", "Keswani", "Borana", "Valimbe", "Kanstiya", "Mahajan"],
  },
  {
    vendor: "Zeroinfy Kolkata - Vsmart",
    names: ["Bhattad", "Taori", "Karmele", "Jai Chawla", "Sarda", "By Vsmart Academy"],
  },
];

/** The arm used when no name in either list appears in the title. */
export const ZEROINFY_KOLKATA_FALLBACK = "Zeroinfy Kolkata - BB";

export const ZEROINFY_KOLKATA_FALLBACK_NOTE = "center arm guessed — review";

/** The sheet value this rule is triggered by. */
export const ZEROINFY_KOLKATA_SHEET_NAME = "Zeroinfy Kolkata";

/**
 * Returns the vendor name to use, and whether it was a guess.
 *
 * First list wins if a title somehow names people from both — which happens
 * with combo titles — and the caller can see it was not a guess either way.
 */
export function resolveCenterArm(courseTitle: string): { vendor: string; guessed: boolean } {
  const haystack = (courseTitle ?? "").toLowerCase();
  for (const arm of ZEROINFY_KOLKATA_ARMS) {
    if (arm.names.some((n) => haystack.includes(n.toLowerCase()))) {
      return { vendor: arm.vendor, guessed: false };
    }
  }
  return { vendor: ZEROINFY_KOLKATA_FALLBACK, guessed: true };
}
