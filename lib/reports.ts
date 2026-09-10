import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ReportRow } from "@/lib/report-shape";

export * from "@/lib/report-shape";

export async function loadReport(
  from: string,
  to: string,
  counsellorId: string | null,
): Promise<{ rows: ReportRow[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_counsellor_report", {
    p_from: from,
    p_to: to,
    p_counsellor_id: counsellorId ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as unknown as ReportRow[], error: null };
}
