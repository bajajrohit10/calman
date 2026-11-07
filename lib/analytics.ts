import "server-only";

import { createClient } from "@/lib/supabase/server";

import type {
  AnalyticsEvent,
  Experiment,
  ExperimentResult,
  AnalyticsFilters,
  AnalyticsScope,
  CompetitorRow,
  CompetitorSplit,
  CourseRow,
  InstituteRow,
  ProductRow,
  TeacherRow,
} from "@/lib/analytics-shape";

/**
 * §81. The analytics reads.
 *
 * Five functions rather than one: the page shows two tabs and a panel over the
 * same window, and keeping them separate means a tab nobody opened is a query
 * nobody ran. All five share app.analytics_leads, so the window and the five
 * filters are defined once in the database — see the migration for why.
 *
 * Every one refuses a caller who is not a manager or super admin. The route
 * 404s first; this is what makes the gate a permission rather than a hidden
 * link.
 *
 * The shapes and the arithmetic live in lib/analytics-shape.ts, which the client
 * view imports; this module is the half that touches the database.
 */

/** The five filters, as the RPCs take them. */
function args(f: AnalyticsFilters) {
  return {
    p_from: f.from,
    p_to: f.to,
    p_course_id: f.courseId || null,
    p_subject_id: f.subjectId || null,
    p_source_ids: f.sourceIds.length ? f.sourceIds : null,
    p_counsellor_id: f.counsellorId || null,
    p_term_id: f.termId || null,
    // §83.3. The comparison window travels with every read, so the strip and the
    // tables can never be comparing against different periods.
    p_cmp_from: f.cmpFrom || null,
    p_cmp_to: f.cmpTo || null,
    // §84.4. The scope is a filter on the same basis, so it travels with the rest.
    p_scope_type: f.scopeType ?? "all",
    p_scope_id: f.scopeId || null,
  };
}

export async function loadAnalytics(f: AnalyticsFilters): Promise<{
  error: string | null;
  scope?: AnalyticsScope;
  teachers: TeacherRow[];
  institutes: InstituteRow[];
  courses: CourseRow[];
  products: ProductRow[];
  events: AnalyticsEvent[];
  experiments: Experiment[];
  /**
   * §89. One row per competitor. In the main batch rather than with the tab,
   * because the Competitor head in "What stands out" names the top one and that
   * panel is on every tab.
   */
  competitors: CompetitorRow[];
  /** Wall time in ms for the whole batch, for the timing note the brief asks for. */
  timings: Record<string, number>;
}> {
  const supabase = await createClient();
  const a = args(f);
  /**
   * One number, not five.
   *
   * Timing each call separately looked informative and was not: the five came
   * back 188 / 283 / 375 / 479 / 558 ms, a ladder rather than five independent
   * costs, because the client serialises them over its connection. Each figure
   * was really "everything before me, plus me", which read as the pivot being
   * twenty times more expensive than it is — measured directly with EXPLAIN
   * ANALYZE, the five execute in 13–38 ms. So what is reported is the batch's
   * wall time, which is the thing a reader can act on.
   */
  const started = Date.now();

  // Together: they read the same window and none of them needs another's answer.
  const [scope, teachers, institutes, courses, products, events, experiments, competitors] =
    await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_scope", a as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_by_teacher", a as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_by_institute", a as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_by_course", a as any),
    // The product block has no comparison column, so it does not take the
    // comparison window — spreading it in would call a function that does not
    // exist with those arguments.
    supabase.rpc("analytics_products", {
      ...a,
      p_cmp_from: undefined,
      p_cmp_to: undefined,
      p_scope_invert: undefined,
      p_limit: 20,
    } as never),
    supabase.rpc("analytics_events_in_range", {
      p_from: f.from,
      p_to: f.to,
      p_cmp_from: f.cmpFrom || null,
      p_cmp_to: f.cmpTo || null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_experiments", {} as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_by_competitor", a as any),
  ]);
  const timings: Record<string, number> = { "all eight": Date.now() - started };

  const firstError =
    scope.error?.message ??
    teachers.error?.message ??
    institutes.error?.message ??
    courses.error?.message ??
    products.error?.message ??
    events.error?.message ??
    experiments.error?.message ??
    competitors.error?.message ??
    null;

  return {
    error: firstError,
    scope: (scope.data as unknown as AnalyticsScope) ?? undefined,
    teachers: (teachers.data ?? []) as unknown as TeacherRow[],
    institutes: (institutes.data ?? []) as unknown as InstituteRow[],
    courses: (courses.data ?? []) as unknown as CourseRow[],
    products: (products.data ?? []) as unknown as ProductRow[],
    events: (events.data ?? []) as unknown as AnalyticsEvent[],
    experiments: (experiments.data ?? []) as unknown as Experiment[],
    competitors: competitorRows(competitors.data),
    timings,
  };
}


/**
 * §89. The Competitors tab: one row per competitor, and the breakdown rows.
 *
 * Loaded on its own for the same reason the experiment results are — three of
 * the four tabs have no use for either — and both in one batch because the
 * expansion is opened by a click on a row that is already on screen, and a
 * read per click would make the first open of each row feel broken.
 */
function competitorRows(data: unknown): CompetitorRow[] {
  type Raw = {
    row_key: string;
    competitor_id: string | null;
    competitor_name: string | null;
    other_name: string | null;
    lost_leads: number;
    prev_lost_leads: number;
  };
  return ((data ?? []) as Raw[]).map((r) => ({
    rowKey: r.row_key,
    competitorId: r.competitor_id,
    competitorName: r.competitor_name,
    otherName: r.other_name,
    lostLeads: Number(r.lost_leads ?? 0),
    prevLostLeads: Number(r.prev_lost_leads ?? 0),
  }));
}

/**
 * §89. The breakdown rows behind the Competitors tab's expansions.
 *
 * Only that tab reads them, and all of them come back in one call rather than
 * one per expanded row: the row is already on screen when it is clicked, and a
 * read per click would make the first open of each row feel broken.
 */
export async function loadCompetitorSplits(f: AnalyticsFilters): Promise<{
  error: string | null;
  splits: CompetitorSplit[];
}> {
  const supabase = await createClient();
  const a = args(f);
  // The splits describe the current window only, so no comparison arguments.
  const { data, error } = await supabase.rpc("analytics_competitor_splits", {
    ...a,
    p_cmp_from: undefined,
    p_cmp_to: undefined,
  } as never);

  type Raw = {
    row_key: string;
    grain: string;
    dim_id: string | null;
    dim_name: string;
    leads: number;
  };
  return {
    error: error?.message ?? null,
    splits: ((data ?? []) as unknown as Raw[]).map((r) => ({
      rowKey: r.row_key,
      grain: r.grain === "institute" ? ("institute" as const) : ("teacher" as const),
      dimId: r.dim_id,
      dimName: r.dim_name,
      leads: Number(r.leads ?? 0),
    })),
  };
}

/**
 * §84.3. One experiment's result, for the Experiments tab.
 *
 * Loaded per card rather than in the page's main batch: the tab is one of three and
 * the other two have no use for it, so a reader on Teachers pays nothing for it.
 */
export async function loadExperimentResults(
  ids: string[],
): Promise<{ error: string | null; results: ExperimentResult[] }> {
  if (!ids.length) return { error: null, results: [] };
  const supabase = await createClient();
  const out = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ids.map((id) => supabase.rpc("analytics_experiment_result", { p_id: id } as any)),
  );
  const firstError = out.find((r) => r.error)?.error?.message ?? null;
  return {
    error: firstError,
    results: out
      .map((r) => r.data as unknown as ExperimentResult | null)
      .filter((r): r is ExperimentResult => Boolean(r?.id)),
  };
}
