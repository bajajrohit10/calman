import "server-only";

import { fetchAllRows } from "@/lib/paged";
import { createClient } from "@/lib/supabase/server";
import type { CallReportRow } from "@/lib/report-shape";

export * from "@/lib/report-shape";

export type ReportGrain = "day" | "counsellor";

/**
 * §5.8, one grain at a time.
 *
 * The per-day table and the per-counsellor table are the same classification
 * grouped two ways, so they come from one function with one parameter. Two
 * SQL implementations is exactly how the old report ended up with three
 * answers to one question.
 *
 * Paged like every other complete-set read: an RPC obeys PostgREST's 1,000-row
 * cap the same way a table read does, and the cap is silent. A day grain over
 * a year is 366 rows, but a counsellor grain is unbounded in principle and the
 * range picker is free text.
 */
export async function loadCallReport(
  from: string,
  to: string,
  counsellorId: string | null,
  grain: ReportGrain,
): Promise<{ rows: CallReportRow[]; error: string | null; truncated?: boolean }> {
  const supabase = await createClient();

  const { rows, error, truncated } = await fetchAllRows<CallReportRow>(
    (rangeFrom, rangeTo) =>
      supabase
        .rpc("call_report", {
          p_from: from,
          p_to: to,
          p_counsellor_id: counsellorId ?? undefined,
          p_grain: grain,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .range(rangeFrom, rangeTo) as never,
  );

  if (error) return { rows: [], error };
  return { rows, error: null, truncated };
}
