import "server-only";

import { loadMasters } from "@/lib/masters";
import { parseProductText } from "@/lib/product-parser";
import { createClient } from "@/lib/supabase/server";

/**
 * Filling a lead's interests in from its product title (§49.2).
 *
 * The rule is narrow on purpose: an enquiry gets auto lines only when it has
 * product text and **no lines at all**. One line entered by a person means a
 * person has thought about this lead, and the parser has nothing to add to
 * that — it cannot know whether the missing second line is an oversight or a
 * decision. So it does nothing rather than guess on top of judgement.
 *
 * Every line it writes carries is_auto, which the screens render in red as
 * "auto — verify" until somebody confirms it. The value of this feature is
 * that a counsellor opens a lead already knowing what it is about; the danger
 * is that they trust it. The tag is what keeps the first without the second.
 */

export type AutoFillResult = {
  /** Enquiries that gained lines. */
  filled: number;
  lines: number;
  /** Enquiries skipped because a person had already recorded something. */
  skippedHuman: number;
  error: string | null;
};

const EMPTY: AutoFillResult = { filled: 0, lines: 0, skippedHuman: 0, error: null };

/**
 * Fill the given enquiries, skipping any that already have lines.
 *
 * Takes ids rather than doing its own search so the callers — Quick Add's
 * save, the import commit — can hand over exactly what they just created, and
 * nothing else on the board can be touched by a bug in a filter here.
 */
export async function applyAutoInterests(
  enquiryIds: number[],
  /**
   * §55.2(d). A teacher named by the file rather than by the title, per
   * enquiry. The Shopify export carries a Vendor; nothing else does, so this
   * is empty for every other caller and the parser reads exactly as before.
   */
  teacherHints: Record<number, string> = {},
): Promise<AutoFillResult> {
  const ids = [...new Set(enquiryIds)].filter((n) => Number.isFinite(n));
  if (!ids.length) return EMPTY;

  const supabase = await createClient();

  const [{ data: enquiries, error: readError }, { data: existing }, masters] =
    await Promise.all([
      supabase
        .from("enquiries")
        .select("id, type, product_text, term_id")
        .in("id", ids),
      supabase.from("enquiry_items").select("enquiry_id").in("enquiry_id", ids),
      loadMasters(),
    ]);

  if (readError) return { ...EMPTY, error: readError.message };
  if (!enquiries?.length) return EMPTY;

  const hasLines = new Set((existing ?? []).map((r) => r.enquiry_id));

  // §55.1. The parser resolves a vendor that names a house rather than a
  // person, but only when that house has exactly one teacher — so it needs to
  // know who is behind each institute. Built once, here, from the masters it
  // already has.
  const parserMasters = {
    ...masters,
    institutes: masters.institutes.map((i) => ({
      ...i,
      teacherIds: masters.teachers
        .filter((t) => t.institute_id === i.id)
        .map((t) => t.id),
    })),
  };

  const rows: {
    enquiry_id: number;
    teacher_id: string | null;
    course_id: string | null;
    subject_id: string | null;
    content_id: string | null;
    status: "open";
    is_auto: true;
  }[] = [];
  const termFor = new Map<number, string>();
  let filled = 0;
  let skippedHuman = 0;

  for (const e of enquiries) {
    if (hasLines.has(e.id)) {
      skippedHuman += 1;
      continue;
    }
    // After-sale enquiries carry no interests — a ticket is about an order,
    // not about what somebody is thinking of buying.
    if (e.type !== "purchase") continue;
    const text = (e.product_text ?? "").trim();
    if (!text) continue;

    const products = parseProductText(text, parserMasters, {
      teacherHint: teacherHints[e.id] ?? null,
    });
    let added = 0;
    for (const p of products) {
      for (const line of p.lines) {
        // The table refuses a line naming nothing, and a subject without its
        // course. Both are the parser's own shapes, so they are dropped here
        // rather than allowed to fail the whole insert.
        if (!line.teacherId && !line.courseId && !line.subjectId && !line.contentId) continue;
        if (line.subjectId && !line.courseId) continue;
        rows.push({
          enquiry_id: e.id,
          teacher_id: line.teacherId,
          course_id: line.courseId,
          subject_id: line.subjectId,
          content_id: line.contentId,
          status: "open",
          is_auto: true,
        });
        added += 1;
      }
      // §49.2: the term goes on the enquiry, and only when it is blank —
      // whatever is already there was put there by somebody who knew.
      if (p.termId && !e.term_id && !termFor.has(e.id)) termFor.set(e.id, p.termId);
    }
    if (added) filled += 1;
  }

  if (!rows.length && !termFor.size) return { ...EMPTY, skippedHuman };

  if (rows.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from("enquiry_items").insert(rows as any);
    if (error) return { ...EMPTY, skippedHuman, error: error.message };
  }

  // The term is one of the four columns the enquiries grant allows, so it can
  // be written directly rather than through a security-definer function.
  for (const [enquiryId, termId] of termFor) {
    await supabase
      .from("enquiries")
      .update({ term_id: termId })
      .eq("id", enquiryId)
      .is("term_id", null);
  }

  return { filled, lines: rows.length, skippedHuman, error: null };
}

/**
 * A person has looked at this lead's lines — they are no longer guesses.
 *
 * §49.2 clears the flag on saving the first-call form or editing any line. The
 * whole enquiry clears at once, not the line that was touched: the counsellor
 * was looking at all of them when they decided one was wrong, so the ones they
 * left alone have been confirmed just as surely as the one they changed.
 */
export async function clearAutoFlag(enquiryId: number): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("enquiry_items")
    .update({ is_auto: false })
    .eq("enquiry_id", enquiryId)
    .eq("is_auto", true);
}
