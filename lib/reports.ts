import "server-only";

import { fetchAllRows } from "@/lib/paged";
import { createClient } from "@/lib/supabase/server";
import type { ReportRow } from "@/lib/report-shape";

export * from "@/lib/report-shape";

/**
 * The report returns one row per counsellor per day, so the row count is
 * days × people — a quarter across a team of a dozen is well past PostgREST's
 * 1,000-row cap, and the cap is silent. An RPC obeys max_rows exactly like a
 * table read, so this pages like any other complete-set read.
 */
export async function loadReport(
  from: string,
  to: string,
  counsellorId: string | null,
): Promise<{ rows: ReportRow[]; error: string | null; truncated?: boolean }> {
  const supabase = await createClient();

  const { rows, error, truncated } = await fetchAllRows<ReportRow>((rangeFrom, rangeTo) =>
    supabase
      .rpc("daily_counsellor_report", {
        p_from: from,
        p_to: to,
        p_counsellor_id: counsellorId ?? undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .range(rangeFrom, rangeTo) as never,
  );

  if (error) return { rows: [], error };
  return { rows, error: null, truncated };
}
