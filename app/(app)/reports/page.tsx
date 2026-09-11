import { PageHeader } from "@/components/ui";
import { isAdmin, requireUser } from "@/lib/auth";
import { istDatePlus, istToday } from "@/lib/format";
import {
  groupByGrain,
  groupStageByGrain,
  loadReport,
  loadStageReport,
  type Grain,
} from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

import { ReportsView } from "./reports-view";

export const metadata = { title: "Reports · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const viewer = await requireUser();
  const sp = await searchParams;
  const admin = isAdmin(viewer.profile?.role ?? "counsellor");

  const from = one(sp.from) ?? istDatePlus(-6);
  const to = one(sp.to) ?? istToday();
  const grain = (one(sp.grain) ?? "day") as Grain;

  // A counsellor sees only themselves. The RPC pins this as well — a query
  // string is not a permission — but there is no reason to offer the control.
  const counsellorId = admin ? one(sp.counsellor) : viewer.userId!;

  const supabase = await createClient();
  const [report, stage, staff] = await Promise.all([
    loadReport(from, to, counsellorId),
    loadStageReport(from, to, counsellorId),
    admin
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("is_active", true)
          .order("full_name")
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="What was actually done, per counsellor per day."
      />
      <ReportsView
        rows={report.rows}
        error={report.error ?? stage.error}
        summary={groupByGrain(report.rows, grain)}
        stageRows={stage.rows}
        stageSummary={groupStageByGrain(stage.rows, grain)}
        from={from}
        to={to}
        grain={grain}
        isAdmin={admin}
        counsellorId={counsellorId}
        roster={(staff.data ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? "(no name)",
        }))}
      />
    </div>
  );
}
