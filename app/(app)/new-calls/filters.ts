import { parseCallTypes, type CallType } from "@/lib/call-type";


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
  /** §47.5: Video / Books / Unknown, undefined for all three. */
  p_call_types: string[] | undefined;
  p_course_id: string | undefined;
  p_teacher_ids: string[] | undefined;
  p_content_ids: string[] | undefined;
  p_institute_id: string | undefined;
  p_importance: string[] | undefined;
  p_term_id: string | undefined;
  p_created_from: string | undefined;
  p_created_to: string | undefined;
  p_product_text: string | undefined;
  /** §57.1: profile ids, plus the literal 'shopify' for the store's own. */
  p_added_by: string[] | undefined;
  /** §57.1: 'default' is importance-then-arrival; 'added_by' is the header. */
  p_sort: string | undefined;
  p_dir: string | undefined;
};

/** The one column this screen can be sorted by, beside its natural order. */
export const NEW_CALLS_SORTS = ["added_by"] as const;
/** §57.1: the store's own leads, as an option id. */
export const SHOPIFY_ADDER = "shopify";

export function parseNewCallsParams(get: ParamReader): {
  page: number;
  sort: string;
  dir: "asc" | "desc";
  sourceIds: string[];
  teacherIds: string[];
  contentIds: string[];
  addedBy: string[];
  callTypes: CallType[];
  filters: NewCallsArgs;
} {
  const page = Math.max(1, Number(str(get, "page") ?? 1) || 1);
  // Repeated ?source= values arrive comma-joined by the form, so both shapes
  // are accepted.
  const many = (key: string) =>
    (str(get, key) ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  const sourceIds = many("source");
  const teacherIds = many("teacher");
  const contentIds = many("content");
  const addedBy = many("addedBy");
  const callTypes = parseCallTypes(str(get, "callType"));
  // Anything else is the natural order, so a hand-edited or stale link cannot
  // ask the function for a sort it does not have.
  const asked = str(get, "sort");
  const sort = NEW_CALLS_SORTS.includes(asked as (typeof NEW_CALLS_SORTS)[number])
    ? (asked as string)
    : "default";
  const dir = str(get, "dir") === "desc" ? "desc" : "asc";

  const opt = (v: string | null) => v ?? undefined;

  return {
    page,
    sort,
    dir,
    sourceIds,
    teacherIds,
    contentIds,
    addedBy,
    callTypes,
    filters: {
      p_source_ids: sourceIds.length ? sourceIds : undefined,
      p_call_types: callTypes.length ? callTypes : undefined,
      p_course_id: opt(str(get, "course")),
      p_teacher_ids: teacherIds.length ? teacherIds : undefined,
      p_content_ids: contentIds.length ? contentIds : undefined,
      p_institute_id: opt(str(get, "institute")),
      p_importance: many("importance").length ? many("importance") : undefined,
      p_term_id: opt(str(get, "term")),
      p_created_from: opt(str(get, "createdFrom")),
      p_created_to: opt(str(get, "createdTo")),
      p_product_text: opt(str(get, "product")),
      p_added_by: addedBy.length ? addedBy : undefined,
      p_sort: sort,
      p_dir: dir,
    },
  };
}
