import "server-only";

import { createClient } from "@/lib/supabase/server";

import type {
  AnalyticsFilters,
  AnalyticsScope,
  DemandRow,
  PivotRow,
  ProductRow,
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
    p_source_id: f.sourceId || null,
    p_counsellor_id: f.counsellorId || null,
  };
}

export async function loadAnalytics(f: AnalyticsFilters): Promise<{
  error: string | null;
  scope?: AnalyticsScope;
  teachers: DemandRow[];
  institutes: DemandRow[];
  pivot: PivotRow[];
  products: ProductRow[];
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
  const [scope, teachers, institutes, pivot, products] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_scope", a as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_by_teacher", a as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_by_institute", a as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_pivot", a as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("analytics_products", { ...a, p_limit: 20 } as any),
  ]);
  const timings: Record<string, number> = { "all five": Date.now() - started };

  const firstError =
    scope.error?.message ??
    teachers.error?.message ??
    institutes.error?.message ??
    pivot.error?.message ??
    products.error?.message ??
    null;

  return {
    error: firstError,
    scope: (scope.data as unknown as AnalyticsScope) ?? undefined,
    teachers: (teachers.data ?? []) as unknown as DemandRow[],
    institutes: (institutes.data ?? []) as unknown as DemandRow[],
    pivot: (pivot.data ?? []) as unknown as PivotRow[],
    products: (products.data ?? []) as unknown as ProductRow[],
    timings,
  };
}

