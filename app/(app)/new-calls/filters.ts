import type { Importance } from "@/lib/enquiry-labels";

/**
 * The New Calls filter bar, parsed once for the page and again for "take next
 * N" — the same guarantee the Assignment Desk gets from
 * app/(app)/assign/filters.ts, and the same query-string names, so a filter
 * built on one screen means the same thing pasted into the other.
 *
 * Source is the exception: this screen takes several at once, because "today's
 * AC and Vsmart leads" is one job rather than two.
 */
export const PAGE_SIZE = 50;

export type ParamReader = (key: string) => string | null;

const str = (get: ParamReader, key: string) => {
  const v = get(key);
  return v === null || v === "" ? null : v;
};

export type NewCallsArgs = {
  p_source_ids: string[] | undefined;
  p_course_id: string | undefined;
  p_teacher_id: string | undefined;
  p_institute_id: string | undefined;
  p_importance: Importance | undefined;
  p_term_id: string | undefined;
  p_created_from: string | undefined;
  p_created_to: string | undefined;
  p_product_text: string | undefined;
};

export function parseNewCallsParams(get: ParamReader): {
  page: number;
  sourceIds: string[];
  filters: NewCallsArgs;
} {
  const page = Math.max(1, Number(str(get, "page") ?? 1) || 1);
  // Repeated ?source= values arrive comma-joined by the form, so both shapes
  // are accepted.
  const sourceIds = (str(get, "source") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const opt = (v: string | null) => v ?? undefined;

  return {
    page,
    sourceIds,
    filters: {
      p_source_ids: sourceIds.length ? sourceIds : undefined,
      p_course_id: opt(str(get, "course")),
      p_teacher_id: opt(str(get, "teacher")),
      p_institute_id: opt(str(get, "institute")),
      p_importance: opt(str(get, "importance")) as Importance | undefined,
      p_term_id: opt(str(get, "term")),
      p_created_from: opt(str(get, "createdFrom")),
      p_created_to: opt(str(get, "createdTo")),
      p_product_text: opt(str(get, "product")),
    },
  };
}
