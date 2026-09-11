import { PageHeader } from "@/components/ui";
import { isAdmin, requireUser } from "@/lib/auth";
import { istToday, istWeekStart } from "@/lib/format";
import { loadCallReport } from "@/lib/reports";
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

  // This week, Monday to today. The week in progress is what anyone opening
  // Reports is asking about; a range ending on Sunday would print empty rows
  // for days that have not happened.
  const from = one(sp.from) ?? istWeekStart();
  const to = one(sp.to) ?? istToday();

  // A counsellor sees only themselves. The RPC pins this as well — a query
  // string is not a permission — but there is no reason to offer the control.
  const counsellorId = admin ? one(sp.counsellor) : viewer.userId!;

  const supabase = await createClient();
  const [byDay, byCounsellor, staff] = await Promise.all([
    loadCallReport(from, to, counsellorId, "day"),
    loadCallReport(from, to, counsellorId, "counsellor"),
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
        description="Every call counted once by type and once by outcome — per day, and per counsellor."
      />
      <ReportsView
        byDay={byDay.rows}
        byCounsellor={byCounsellor.rows}
        error={byDay.error ?? byCounsellor.error}
        from={from}
        to={to}
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
