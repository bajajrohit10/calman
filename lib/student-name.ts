import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Fill a student's name from an arriving row, but only if there isn't one.
 *
 * Brief 31 rule 3: a number that is already here takes the new source, and has
 * its product text and name filled in *if blank*. Never overwritten — a name
 * on file was typed by somebody who had the person on the phone, and a name in
 * a spreadsheet was typed by whoever built the spreadsheet.
 *
 * Shared by Quick Add's grid and the importer so the rule is one rule. It sits
 * here rather than inside import_re_enquire because that function is on the
 * hot path of a three-thousand-row import and changing its signature to carry
 * a name would mean dropping and recreating two live security-definer
 * functions for a single optional field.
 *
 * A failure is returned, not thrown: the enquiry is already saved by the time
 * this runs, and a name that would not go in is worth a line in the report
 * rather than the loss of the row.
 */
export async function fillBlankStudentName(
  supabase: Client,
  studentId: string | null,
  name: string | null,
): Promise<{ filled: boolean; keptExisting: string | null; error: string | null }> {
  const wanted = name?.trim() || null;
  if (!studentId || !wanted) return { filled: false, keptExisting: null, error: null };

  const { data, error } = await supabase
    .from("students")
    .select("name")
    .eq("id", studentId)
    .maybeSingle();
  if (error) return { filled: false, keptExisting: null, error: error.message };

  const current = data?.name?.trim() || null;
  if (current) {
    return {
      filled: false,
      keptExisting: current === wanted ? null : current,
      error: null,
    };
  }

  const { error: writeError } = await supabase
    .from("students")
    .update({ name: wanted })
    .eq("id", studentId);
  return {
    filled: !writeError,
    keptExisting: null,
    error: writeError?.message ?? null,
  };
}
