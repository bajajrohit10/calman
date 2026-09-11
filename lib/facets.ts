import "server-only";

import { buildFacetMap, type FacetMap, type FacetRow } from "@/lib/facet-shape";
import type { NewCallsArgs } from "@/app/(app)/new-calls/filters";
import type { RecommendedFilters } from "@/lib/recommended";
import { createClient } from "@/lib/supabase/server";

/**
 * Loading the facet counts for one screen (§5.5, §5.12).
 *
 * One call per screen, not one per facet: see migration 0025. The row count is
 * bounded by the master lists (73 teachers is the largest, ~140 rows in total),
 * so the PostgREST 1,000-row cap is far away — but it is silent when it does
 * bite, so the read asks for a ceiling well above the possible total and treats
 * hitting it as a failure rather than as data.
 */
const FACET_CEILING = 900;

type Loaded = { facets: FacetMap | null; error: string | null };

function finish(rows: FacetRow[] | null, error: string | null): Loaded {
  if (error) return { facets: null, error };
  const list = rows ?? [];
  if (list.length >= FACET_CEILING) {
    return {
      facets: null,
      error: `The filter counts returned ${list.length} rows, at or over the ${FACET_CEILING} ceiling — they may be truncated, so they are not being shown.`,
    };
  }
  return { facets: buildFacetMap(list), error: null };
}

export async function loadDeskFacets(f: RecommendedFilters): Promise<Loaded> {
  const supabase = await createClient();
  const clean = <T>(v: T | null | undefined) => (v === null || v === "" ? undefined : v);

  const { data, error } = await supabase
    .rpc("recommended_facets", {
      p_date: clean(f.date),
      p_include_not_due: f.includeNotDue ?? false,
      p_counsellor_id: clean(f.counsellorId),
      p_teacher_ids: f.teacherIds?.length ? f.teacherIds : undefined,
      p_course_id: clean(f.courseId),
      p_subject_id: clean(f.subjectId),
      p_content_ids: f.contentIds?.length ? f.contentIds : undefined,
      p_institute_id: clean(f.instituteId),
      p_stages: f.stages?.length ? f.stages : undefined,
      p_last_called_from: clean(f.lastCalledFrom),
      p_last_called_to: clean(f.lastCalledTo),
      p_term_id: clean(f.termId),
      p_source_id: clean(f.sourceId),
      p_importance: clean(f.importance),
      p_type: clean(f.type),
      p_status: clean(f.status),
      p_created_from: clean(f.createdFrom),
      p_created_to: clean(f.createdTo),
      p_follow_up_from: clean(f.followUpFrom),
      p_follow_up_to: clean(f.followUpTo),
      p_discussion: clean(f.discussion),
      p_assignment: clean(f.assignment),
      p_last_called_by: f.lastCalledBy?.length ? f.lastCalledBy : undefined,
      p_last_outcomes: f.lastOutcomes?.length ? f.lastOutcomes : undefined,
      p_no_detail: f.noDetail?.length ? f.noDetail : undefined,
      p_bucket: clean(f.bucket),
      p_offer_ids: f.offerIds?.length ? f.offerIds : undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .limit(FACET_CEILING);

  return finish(data as unknown as FacetRow[] | null, error?.message ?? null);
}

export async function loadNewCallsFacets(args: NewCallsArgs): Promise<Loaded> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("new_calls_facets", {
      p_source_ids: args.p_source_ids,
      p_course_id: args.p_course_id,
      p_teacher_ids: args.p_teacher_ids,
      p_content_ids: args.p_content_ids,
      p_institute_id: args.p_institute_id,
      p_importance: args.p_importance,
      p_term_id: args.p_term_id,
      p_created_from: args.p_created_from,
      p_created_to: args.p_created_to,
      p_product_text: args.p_product_text,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .limit(FACET_CEILING);

  return finish(data as unknown as FacetRow[] | null, error?.message ?? null);
}

/**
 * The guard. Two queries meant to agree about scope will eventually stop
 * agreeing; when they do, showing no counts is right and showing wrong ones is
 * not. Called with the list's own total.
 */
export function facetsAgreeWithList(
  facets: FacetMap | null,
  listTotal: number,
): FacetMap | null {
  if (!facets) return null;
  return facets.total === listTotal ? facets : null;
}
